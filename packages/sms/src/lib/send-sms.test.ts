/**
 * Tests of `sms/lib/send-sms` on fake drivers registered through `useSms()`.
 *
 * `@novastarter/logger` and `@novastarter/emitter` are mocked; the limiter is the real local one of
 * `@novastarter/memory`.
 */
import { useEmitter } from '@novastarter/emitter';
import { createError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { LimiterDriverLocal } from '@novastarter/memory';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SmsDriver } from '../driver.js';
import type { SmsMessage, SmsResult } from '../types.js';
import { sendSms, SMS_FAILED_EVENT, SMS_PARTIAL_DELIVERY_CODE, SMS_SEND_FILTER, SMS_SENT_EVENT } from './send-sms.js';
import { useSms } from './use-sms.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// The fake drivers join the driver map the way a driver package does, so their registrations type-check
declare module './sms-manager.js' {
	interface SmsDrivers {
		ok: Record<string, never>;
		broken: Record<string, never>;
		rude: Record<string, never>;
		partial: Record<string, never>;
	}
}

/**
 * Logger double recording the warnings `sendSms()` writes.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Emitter double: the filter hands the message back unchanged unless a test says otherwise, the action only records.
 */
const emitter = { emitFilter: vi.fn(async (_event: string, payload: unknown) => payload), emitAction: vi.fn() };

/**
 * Every message the `ok` driver was asked to send.
 */
const sent: SmsMessage[] = [];

/**
 * A driver that accepts everything and records it.
 */
class OkDriver implements SmsDriver {
	/**
	 * Record the message and accept it.
	 *
	 * @param message - Message to send.
	 * @returns A fixed id, so the tests can tell the result apart from the location.
	 */
	async send(message: SmsMessage): Promise<SmsResult> {
		// 1. Recorded for the assertions, accepted as given
		sent.push(message);

		return { messageId: 'ok-1', status: 'queued', segments: 1 };
	}
}

/**
 * A driver whose provider is down.
 */
class BrokenDriver implements SmsDriver {
	/**
	 * Refuse every message.
	 *
	 * @throws Always.
	 */
	async send(): Promise<SmsResult> {
		// 1. An `Error` with a fixed message, so the tests can match it as the `cause` of the send failure
		throw new Error('provider is down');
	}
}

/**
 * A driver whose SDK rejects with a string instead of an `Error`.
 */
class RudeDriver implements SmsDriver {
	/**
	 * Refuse every message with a bare string.
	 *
	 * @throws Always, a string.
	 */
	async send(): Promise<SmsResult> {
		// 1. Not an `Error` on purpose: pino would take a string for the message and drop the location from the line
		throw 'rate limited';
	}
}

/**
 * The error a driver throws when the provider accepted some parts of a long text and refused the rest, built the way
 * `@novastarter/sms-driver-vonage` builds its `SmsPartialDeliveryError`: a `createError` class carrying
 * {@link SMS_PARTIAL_DELIVERY_CODE}, so the chain's structural `isNovastarterError` check sees the real shape.
 */
const SmsPartialDeliveryError = createError<{ delivered: number; parts: number; reason: string }>(
	SMS_PARTIAL_DELIVERY_CODE,
	({ delivered, parts, reason }) =>
		`The sms was partially delivered: ${delivered} of ${parts} parts went out; do not re-send, those parts would go out twice (${reason})`,
);

/**
 * A driver whose provider accepts a long text in part only.
 */
class PartialDriver implements SmsDriver {
	/**
	 * Throw a partial-delivery error for every message.
	 *
	 * @throws Always, the `SmsPartialDeliveryError`-shaped error above.
	 */
	async send(): Promise<SmsResult> {
		// 1. The shape `@novastarter/sms-driver-vonage` throws for a half-accepted text
		throw new SmsPartialDeliveryError({ delivered: 1, parts: 2, reason: '9: Partner quota violation' });
	}
}

/**
 * Register the fake drivers and the given locations on the process-wide manager.
 *
 * @param locations - Location name to driver name.
 */
const register = (locations: Record<string, 'ok' | 'broken' | 'rude' | 'partial'>): void => {
	// 1. Every fake driver is always known; the test decides which locations exist and in which order
	const manager = useSms();

	manager.registerDriver('ok', OkDriver);
	manager.registerDriver('broken', BrokenDriver);
	manager.registerDriver('rude', RudeDriver);
	manager.registerDriver('partial', PartialDriver);

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
const message: SmsMessage = { to: '+14155550123', text: 'Your code is 123456' };

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(logger as unknown as ReturnType<typeof useLogger>);
	vi.mocked(useEmitter).mockReturnValue(emitter as unknown as ReturnType<typeof useEmitter>);
});

afterEach(() => {
	useSms.reset();
	sent.length = 0;
	vi.clearAllMocks();
});

describe('sendSms', () => {
	test('Fills the sender of the routes in, sends through the first location and emits sms.sent', async () => {
		register({ main: 'ok' });
		useSms().registerRoutes({ from: 'Acme' });

		const result = await sendSms(message);

		// 1. The answer names the location that delivered, on top of what the driver said
		expect(result).toStrictEqual({ messageId: 'ok-1', status: 'queued', segments: 1, location: 'main' });

		// 2. The driver saw the message with the sender filled in
		expect(sent[0]).toStrictEqual({ to: '+14155550123', text: 'Your code is 123456', from: 'Acme' });

		// 3. The filter ran before, the action after
		expect(emitter.emitFilter).toHaveBeenCalledWith(SMS_SEND_FILTER, message, { category: 'transactional' });
		expect(emitter.emitAction).toHaveBeenCalledWith(SMS_SENT_EVENT, expect.objectContaining({ location: 'main' }));
	});

	test('Normalises the recipient and refuses one that is not E.164, or a blank text', async () => {
		register({ main: 'ok' });

		// 1. Separators and the `00` prefix are cleaned up before the driver sees the number
		await sendSms({ ...message, to: '0044 (7700) 900-123' });

		expect(sent[0]?.to).toBe('+447700900123');

		// 2. A national number would need a country to be guessed; refused by name instead
		await expect(sendSms({ ...message, to: '4155550123' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
		await expect(sendSms({ ...message, to: '4155550123' })).rejects.toThrow(/not a phone number in E.164/);

		// 3. A text of whitespace would be billed for nothing
		await expect(sendSms({ ...message, text: '  ' })).rejects.toThrow(/no text/);
		expect(sent).toHaveLength(1);
	});

	test('Lets the message sender win over the routes and sends without one when neither has it', async () => {
		register({ main: 'ok' });
		useSms().registerRoutes({ from: 'Acme' });

		// 1. The message's own sender is kept as given
		await sendSms({ ...message, from: '+14155550100' });

		expect(sent[0]?.from).toBe('+14155550100');

		// 2. Without a sender anywhere the message still goes out: the location's provider may supply one, and a
		//    driver that cannot refuses it by name
		useSms().registerRoutes({});
		await sendSms(message);

		expect(sent[1]).toStrictEqual({ to: '+14155550123', text: 'Your code is 123456' });
	});

	test('Lets a filter rewrite or drop the message, checking the rewrite like the original', async () => {
		register({ main: 'ok' });
		useSms().registerRoutes({ from: 'Acme' });

		// 1. A rewrite reaches the driver, its recipient normalised the same way
		emitter.emitFilter.mockResolvedValueOnce({ ...message, to: '+1 415 555 0199', text: 'Redirected' });
		await sendSms(message);

		expect(sent[0]).toMatchObject({ to: '+14155550199', text: 'Redirected' });

		// 2. A handler that broke the number is refused here rather than by a provider
		emitter.emitFilter.mockResolvedValueOnce({ ...message, to: 'test-phone' });

		await expect(sendSms(message)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });

		// 3. A veto answers `null` and sends nothing
		emitter.emitFilter.mockResolvedValueOnce(null);

		expect(await sendSms(message)).toBeNull();
		expect(sent).toHaveLength(1);
	});

	test('Falls back down the chain and throws with the last failure when every location failed', async () => {
		register({ first: 'broken', second: 'ok' });
		useSms().registerRoutes({ from: 'Acme', transactional: ['first', 'second'] });

		// 1. The broken location is logged and skipped; the next one delivers
		expect(await sendSms(message)).toMatchObject({ location: 'second' });

		expect(logger.warn).toHaveBeenCalledWith(expect.any(Error), 'Sms location "first" failed to send to +14155550123');

		// 2. An explicit location ignores the routes — and, being broken, fails the send with its error as cause
		const failure = sendSms(message, { location: 'first' });

		await expect(failure).rejects.toThrow('Every sms location failed (first)');
		await expect(failure).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'provider is down' }) });

		expect(emitter.emitAction).toHaveBeenCalledWith(
			SMS_FAILED_EVENT,
			expect.objectContaining({ locations: ['first'] }),
		);
	});

	test('Rethrows a partial delivery as-is instead of falling back', async () => {
		register({ first: 'partial', second: 'ok' });
		useSms().registerRoutes({ from: 'Acme', transactional: ['first', 'second'] });

		// 1. The part the provider accepted is already on its way: the chain must not hand the message to the next
		//    location, which would deliver that part again
		const error = await sendSms(message).catch((thrown: unknown) => thrown);

		// 2. The driver's error passes untouched: not wrapped in 'Every sms location failed', not logged as a failed
		//    location, and no sms.failed event — a partial delivery is neither a send nor a refusal
		expect(error).toBeInstanceOf(SmsPartialDeliveryError);

		expect(error).toMatchObject({
			code: SMS_PARTIAL_DELIVERY_CODE,
			extensions: { delivered: 1, parts: 2, reason: '9: Partner quota violation' },
		});

		expect(sent).toHaveLength(0);
		expect(logger.warn).not.toHaveBeenCalled();
		expect(emitter.emitAction).not.toHaveBeenCalled();
	});

	test('Logs a non-Error rejection as an Error, keeping the location in the line', async () => {
		register({ first: 'rude', second: 'ok' });
		useSms().registerRoutes({ from: 'Acme', transactional: ['first', 'second'] });

		// 1. The string is wrapped, so pino keeps the kit's line and the location; the raw value stays as the cause
		expect(await sendSms(message)).toMatchObject({ location: 'second' });

		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'rate limited', cause: 'rate limited' }),
			'Sms location "first" failed to send to +14155550123',
		);

		expect(logger.warn.mock.calls[0]?.[0]).toBeInstanceOf(Error);
	});

	test('Refuses an explicit location nobody registered before sending anything', async () => {
		register({ main: 'ok' });
		useSms().registerRoutes({ from: 'Acme' });

		// 1. A typo in the location name is a configuration mistake, named as such: no warning, no `sms.failed`
		await expect(sendSms(message, { location: 'mian' })).rejects.toThrow('Sms location "mian" doesn\'t exist.');

		expect(sent).toHaveLength(0);
		expect(logger.warn).not.toHaveBeenCalled();
		expect(emitter.emitAction).not.toHaveBeenCalled();
	});

	test('Skips a location over its rate limit and rethrows the limit when every location is', async () => {
		register({ main: 'ok', backup: 'ok' });

		useSms().registerRoutes({
			from: 'Acme',
			limiters: {
				main: new LimiterDriverLocal({ points: 1, duration: 60 }),
			},
		});

		// 1. The first message spends the budget of `main`; the second is routed past it
		expect(await sendSms(message)).toMatchObject({ location: 'main' });
		expect(await sendSms(message)).toMatchObject({ location: 'backup' });
		expect(logger.warn).toHaveBeenCalledWith('Sms location "main" is over its rate limit; trying the next one');

		// 2. Only limited locations in the chain: the limiter's own error tells the caller when to retry
		await expect(sendSms(message, { location: 'main' })).rejects.toMatchObject({ code: 'REQUESTS_EXCEEDED' });
	});

	test('Throws when no location is registered', async () => {
		// 1. Routes without locations: the chain is empty before any driver is asked
		useSms().registerRoutes({ from: 'Acme' });

		await expect(sendSms(message)).rejects.toThrow('No sms location is registered');
	});
});
