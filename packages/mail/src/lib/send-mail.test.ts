/**
 * Tests of `mail/lib/send-mail` on fake drivers registered through `useMail()`.
 *
 * `@novastarter/logger` and `@novastarter/emitter` are mocked; the limiter is the real local one of
 * `@novastarter/memory`.
 */
import { useEmitter } from '@novastarter/emitter';
import { useLogger } from '@novastarter/logger';
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
	}
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
		// 1. Recorded for the assertions, accepted as given
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
		throw new Error('provider is down');
	}
}

/**
 * Register the fake drivers and the given locations on the process-wide manager.
 *
 * @param locations - Location name to driver name.
 */
const register = (locations: Record<string, 'ok' | 'broken'>): void => {
	// 1. Both drivers are always known; the test decides which locations exist and in which order
	const manager = useMail();

	manager.registerDriver('ok', OkDriver);
	manager.registerDriver('broken', BrokenDriver);

	for (const [name, driver] of Object.entries(locations)) {
		manager.registerLocation(name, {
			driver,
			options: {},
		});
	}
};

const message: MailMessage = { to: 'ada@example.com', subject: 'Hi', text: 'Hello' };

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(logger as any);
	vi.mocked(useEmitter).mockReturnValue(emitter as any);
});

afterEach(() => {
	useMail.reset();
	sent.length = 0;
	vi.clearAllMocks();
});

describe('sendMail', () => {
	test('Fills the sender of the routes in, sends through the first location and emits mail.sent', async () => {
		register({ main: 'ok' });
		useMail().registerRoutes({ from: { name: 'Acme', address: 'no-reply@acme.test' } });

		const result = await sendMail(message);

		// 1. The answer names the location that delivered, on top of what the driver said
		expect(result).toStrictEqual({ messageId: 'ok-1', accepted: ['ada@example.com'], rejected: [], location: 'main' });

		// 2. The driver saw the message with the sender filled in
		expect(sent[0]).toMatchObject({ from: { name: 'Acme', address: 'no-reply@acme.test' }, subject: 'Hi' });

		// 3. The filter ran before, the action after
		expect(emitter.emitFilter).toHaveBeenCalledWith(MAIL_SEND_FILTER, message, { category: 'transactional' });
		expect(emitter.emitAction).toHaveBeenCalledWith(MAIL_SENT_EVENT, expect.objectContaining({ location: 'main' }));
	});

	test('Lets the message sender win over the routes and refuses a message without any', async () => {
		register({ main: 'ok' });

		// 1. No sender anywhere: refused before any driver runs
		await expect(sendMail(message)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });

		// 2. A half-filled object is refused too, by name
		await expect(sendMail({ ...message, from: { name: '', address: 'x@y.z' } })).rejects.toThrow(/name and address/);

		// 3. The message's own sender is kept as given
		useMail().registerRoutes({ from: 'no-reply@acme.test' });
		await sendMail({ ...message, from: 'ada@acme.test' });

		expect(sent[0]?.from).toBe('ada@acme.test');
	});

	test('Lets a filter rewrite or drop the message', async () => {
		register({ main: 'ok' });
		useMail().registerRoutes({ from: 'no-reply@acme.test' });

		// 1. A rewrite reaches the driver; the html is trimmed line by line on the way
		emitter.emitFilter.mockResolvedValueOnce({ ...message, html: '  <p>\n   hi\n</p>  ' });
		await sendMail(message);

		expect(sent[0]?.html).toBe('<p>\nhi\n</p>');

		// 2. A veto answers `null` and sends nothing
		emitter.emitFilter.mockResolvedValueOnce(null);

		expect(await sendMail(message)).toBeNull();
		expect(sent).toHaveLength(1);
	});

	test('Falls back down the chain and throws with the last failure when every location failed', async () => {
		register({ first: 'broken', second: 'ok' });
		useMail().registerRoutes({ from: 'no-reply@acme.test', transactional: ['first', 'second'] });

		// 1. The broken location is logged and skipped; the next one delivers
		expect(await sendMail(message)).toMatchObject({ location: 'second' });
		expect(logger.warn).toHaveBeenCalledWith(expect.any(Error), 'Mail location "first" failed to send "Hi"');

		// 2. An explicit location ignores the routes — and, being broken, fails the send with its error as cause
		const failure = sendMail(message, { location: 'first' });

		await expect(failure).rejects.toThrow('Every mail location failed (first)');
		await expect(failure).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'provider is down' }) });

		expect(emitter.emitAction).toHaveBeenCalledWith(
			MAIL_FAILED_EVENT,
			expect.objectContaining({ locations: ['first'] }),
		);
	});

	test('Skips a location over its rate limit and rethrows the limit when every location is', async () => {
		register({ main: 'ok', backup: 'ok' });

		useMail().registerRoutes({
			from: 'no-reply@acme.test',
			limiters: {
				main: new LimiterDriverLocal({ points: 1, duration: 60 }),
			},
		});

		// 1. The first message spends the budget of `main`; the second is routed past it
		expect(await sendMail(message)).toMatchObject({ location: 'main' });
		expect(await sendMail(message)).toMatchObject({ location: 'backup' });
		expect(logger.warn).toHaveBeenCalledWith('Mail location "main" is over its rate limit; trying the next one');

		// 2. Only limited locations in the chain: the limiter's own error tells the caller when to retry
		await expect(sendMail(message, { location: 'main' })).rejects.toMatchObject({ code: 'REQUESTS_EXCEEDED' });
	});

	test('Throws when no location is registered', async () => {
		// 1. Routes without locations: the chain is empty before any driver is asked
		useMail().registerRoutes({ from: 'no-reply@acme.test' });

		await expect(sendMail(message)).rejects.toThrow('No mail location is registered');
	});
});

describe('normalizeHtml', () => {
	test('Trims every line', () => {
		// 1. Leading and trailing whitespace of every line goes; the line breaks stay
		expect(normalizeHtml('  <p>\n\t\thi  \n</p>')).toBe('<p>\nhi\n</p>');
	});
});
