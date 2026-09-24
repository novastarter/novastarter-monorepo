/**
 * Tests of `mail/lib/send-mail` on fake drivers registered through `useMail()`.
 *
 * `@novastarter/logger` and `@novastarter/emitter` are mocked; the limiter is the real local one of
 * `@novastarter/memory`.
 */
import { type Emitter, useEmitter } from '@novastarter/emitter';
import { InvalidConfigError } from '@novastarter/errors';
import { type Logger, useLogger } from '@novastarter/logger';
import { LimiterDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MailDriver } from '../driver.js';
import type { MailMessage, MailResult } from '../types.js';
import { MAIL_FAILED_EVENT, MAIL_SEND_FILTER, MAIL_SENT_EVENT, normalizeHtml, sendMail } from './send-mail.js';
import { useMail } from './use-mail.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// The fake drivers join the driver map the way a driver package does, so their registrations type-check
declare module './mail-manager.js' {
	interface MailDrivers {
		ok: Record<string, never>;
		broken: Record<string, never>;
		rude: Record<string, never>;
	}
}

/**
 * Logger double recording the warnings `sendMail()` writes.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Emitter double: the filter hands the message back unchanged unless a test says otherwise, the action only records.
 */
const emitter = { emitFilter: vi.fn(async (_event: string, payload: unknown) => payload), emitAction: vi.fn() };

/**
 * Every message the `ok` driver was asked to send.
 */
const sent: MailMessage[] = [];

/**
 * A driver that accepts everything and records it.
 */
class OkDriver implements MailDriver {
	/**
	 * Record the message and accept its recipients.
	 *
	 * @param message - Rendered message.
	 * @returns Every recipient as accepted.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		sent.push(message);

		return { messageId: 'ok-1', accepted: [String(message.to)], rejected: [] };
	}
}

/**
 * A driver whose provider is down.
 */
class BrokenDriver implements MailDriver {
	/**
	 * Refuse every message.
	 *
	 * @throws Always.
	 */
	async send(): Promise<MailResult> {
		// An `Error` with a fixed message, so the tests can match it as the `cause` of the send failure
		throw new Error('provider is down');
	}
}

/**
 * A driver whose SDK rejects with a string instead of an `Error`.
 */
class RudeDriver implements MailDriver {
	/**
	 * Refuse every message with a bare string.
	 *
	 * @throws Always, a string.
	 */
	async send(): Promise<MailResult> {
		// Not an `Error` on purpose: pino would take a string for the message and drop the location from the line
		throw 'rate limited';
	}
}

/**
 * Register the fake drivers and the given locations on the process-wide manager.
 *
 * @param locations - Location name to driver name.
 */
const register = (locations: Record<string, 'ok' | 'broken' | 'rude'>): void => {
	const manager = useMail();

	manager.registerDriver('ok', OkDriver);
	manager.registerDriver('broken', BrokenDriver);
	manager.registerDriver('rude', RudeDriver);

	for (const [name, driver] of Object.entries(locations)) {
		manager.registerLocation(name, {
			driver,
			options: {},
		});
	}
};

/**
 * The message every test sends: no sender, so the routes have to fill it in.
 */
const message: MailMessage = { to: 'ada@example.com', subject: 'Hi', text: 'Hello' };

beforeEach(() => {
	// The doubles replace the process-wide logger and emitter, so the manager the test builds works without them
	vi.mocked(useLogger).mockReturnValue(logger as unknown as Logger);
	vi.mocked(useEmitter).mockReturnValue(emitter as unknown as Emitter);
});

afterEach(() => {
	// The manager is process-wide: reset it, so registrations of one test never leak into the next
	useMail.reset();

	sent.length = 0;
	vi.clearAllMocks();
});

describe('sendMail', () => {
	test('Fills the sender of the routes in, sends through the first location and emits mail.sent', async () => {
		register({ main: 'ok' });
		useMail().registerRoutes({ from: { name: 'Acme', address: 'no-reply@acme.test' } });

		const result = await sendMail(message);

		expect(result).toStrictEqual({ messageId: 'ok-1', accepted: ['ada@example.com'], rejected: [], location: 'main' });

		expect(sent[0]).toMatchObject({ from: { name: 'Acme', address: 'no-reply@acme.test' }, subject: 'Hi' });

		expect(emitter.emitFilter).toHaveBeenCalledWith(MAIL_SEND_FILTER, message, { category: 'transactional' });
		expect(emitter.emitAction).toHaveBeenCalledWith(MAIL_SENT_EVENT, expect.objectContaining({ location: 'main' }));
	});

	test('Lets the message sender win over the routes and refuses a message without any', async () => {
		register({ main: 'ok' });

		await expect(sendMail(message)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });

		await expect(sendMail({ ...message, from: { name: '', address: 'x@y.z' } })).rejects.toThrow(/name and address/);

		useMail().registerRoutes({ from: 'no-reply@acme.test' });
		await sendMail({ ...message, from: 'ada@acme.test' });

		expect(sent[0]?.from).toBe('ada@acme.test');
	});

	test('Lets a filter rewrite or drop the message', async () => {
		register({ main: 'ok' });
		useMail().registerRoutes({ from: 'no-reply@acme.test' });

		emitter.emitFilter.mockResolvedValueOnce({ ...message, html: '  <p>\n   hi\n</p>  ' });
		await sendMail(message);

		expect(sent[0]?.html).toBe('<p>\nhi\n</p>');

		emitter.emitFilter.mockResolvedValueOnce(null);

		expect(await sendMail(message)).toBeNull();
		expect(sent).toHaveLength(1);
	});

	test('Falls back down the chain and throws with the last failure when every location failed', async () => {
		register({ first: 'broken', second: 'ok' });
		useMail().registerRoutes({ from: 'no-reply@acme.test', transactional: ['first', 'second'] });

		expect(await sendMail(message)).toMatchObject({ location: 'second' });
		expect(logger.warn).toHaveBeenCalledWith(expect.any(Error), 'Mail location "first" failed to send "Hi"');

		const failure = sendMail(message, { location: 'first' });

		await expect(failure).rejects.toThrow('Every mail location failed (first)');
		await expect(failure).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'provider is down' }) });

		expect(emitter.emitAction).toHaveBeenCalledWith(
			MAIL_FAILED_EVENT,
			expect.objectContaining({ locations: ['first'] }),
		);
	});

	test('Logs a non-Error rejection as an Error, keeping the location in the line', async () => {
		register({ first: 'rude', second: 'ok' });
		useMail().registerRoutes({ from: 'no-reply@acme.test', transactional: ['first', 'second'] });

		// The string is wrapped, so pino keeps the kit's line and the location; the raw value stays as the cause
		expect(await sendMail(message)).toMatchObject({ location: 'second' });

		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'rate limited', cause: 'rate limited' }),
			'Mail location "first" failed to send "Hi"',
		);

		expect(logger.warn.mock.calls[0]?.[0]).toBeInstanceOf(Error);
	});

	test('Refuses an explicit location nobody registered before sending anything', async () => {
		register({ main: 'ok' });
		useMail().registerRoutes({ from: 'no-reply@acme.test' });

		await expect(sendMail(message, { location: 'mian' })).rejects.toThrow(InvalidConfigError);
		await expect(sendMail(message, { location: 'mian' })).rejects.toThrow('Mail location "mian" doesn\'t exist');

		expect(sent).toHaveLength(0);
		expect(logger.warn).not.toHaveBeenCalled();
		expect(emitter.emitAction).not.toHaveBeenCalled();
	});

	test('Skips a location over its rate limit and rethrows the limit when every location is', async () => {
		register({ main: 'ok', backup: 'ok' });

		useMail().registerRoutes({
			from: 'no-reply@acme.test',
			limiters: {
				main: new LimiterDriverLocal({ points: 1, duration: 60 }),
			},
		});

		expect(await sendMail(message)).toMatchObject({ location: 'main' });
		expect(await sendMail(message)).toMatchObject({ location: 'backup' });
		expect(logger.warn).toHaveBeenCalledWith('Mail location "main" is over its rate limit; trying the next one');

		await expect(sendMail(message, { location: 'main' })).rejects.toMatchObject({ code: 'REQUESTS_EXCEEDED' });
	});

	test('Throws when no location is registered', async () => {
		useMail().registerRoutes({ from: 'no-reply@acme.test' });

		await expect(sendMail(message)).rejects.toThrow(InvalidConfigError);
		await expect(sendMail(message)).rejects.toThrow('No mail location is registered');
	});
});

describe('normalizeHtml', () => {
	test('Trims every line', () => {
		expect(normalizeHtml('  <p>\n\t\thi  \n</p>')).toBe('<p>\nhi\n</p>');
	});
});
