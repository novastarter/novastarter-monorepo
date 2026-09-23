/**
 * Tests of `push/lib/send-push` on fake drivers registered through `usePush()`.
 *
 * `@novastarter/logger` and `@novastarter/emitter` are mocked.
 */
import { useEmitter } from '@novastarter/emitter';
import { InvalidPayloadError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PushDriver } from '../driver.js';
import { PushTargetGoneError } from '../errors/index.js';
import type { PushMessage, PushPlatform, PushResult } from '../types.js';
import { PUSH_FAILED_EVENT, PUSH_GONE_EVENT, PUSH_SEND_FILTER, PUSH_SENT_EVENT, sendPush } from './send-push.js';
import { usePush } from './use-push.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// The fake drivers join the driver map the way a driver package does, so their registrations type-check
declare module './push-manager.js' {
	interface PushDrivers {
		'ok-web': Record<string, never>;
		'ok-token': Record<string, never>;
		down: Record<string, never>;
		gone: Record<string, never>;
		rude: Record<string, never>;
	}
}

/**
 * The mocked application logger.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * The mocked emitter: the filter passes the message through untouched unless a test says otherwise.
 */
const emitter = { emitFilter: vi.fn(async (_event: string, payload: unknown) => payload), emitAction: vi.fn() };

/**
 * Every message the `ok` drivers were asked to send.
 */
const sent: PushMessage[] = [];

/**
 * A driver class that accepts every message of its platforms and records it.
 *
 * @param platforms - What it delivers to.
 * @returns The class.
 */
const okDriver = (platforms: PushPlatform[]): typeof PushDriver =>
	class implements PushDriver {
		/** What the class was built for: `webpush` only, or both token platforms. */
		readonly platforms: readonly PushPlatform[] = platforms;

		/**
		 * Record the message and accept it.
		 *
		 * @param message - The message.
		 * @returns A fixed id.
		 */
		async send(message: PushMessage): Promise<PushResult> {
			// 1. Recorded for the assertions, accepted as given
			sent.push(message);

			return { messageId: 'ok-1', status: 'accepted' };
		}
	};

/**
 * A driver whose push service is down.
 */
class DownDriver implements PushDriver {
	/** Every platform, so any location can be pointed at it. */
	readonly platforms: readonly PushPlatform[] = ['webpush', 'fcm', 'apns'];

	/**
	 * Refuse every message.
	 *
	 * @throws Always.
	 */
	async send(): Promise<PushResult> {
		// 1. A plain `Error`, the way an SDK reports an unreachable service; it becomes the `cause` of the one thrown
		throw new Error('push service is down');
	}
}

/**
 * A driver whose push service says every target is gone.
 */
class GoneDriver implements PushDriver {
	/** Every platform, so any location can be pointed at it. */
	readonly platforms: readonly PushPlatform[] = ['webpush', 'fcm', 'apns'];

	/**
	 * Report the target dead.
	 *
	 * @throws PushTargetGoneError always.
	 */
	async send(): Promise<PushResult> {
		// 1. The error a driver throws for a 410: `sendPush()` must pass it on untouched, not wrap it
		throw new PushTargetGoneError({ platform: 'webpush', reason: '410 from https://push.example' });
	}
}

/**
 * A driver whose SDK rejects with a string instead of an `Error`.
 */
class RudeDriver implements PushDriver {
	/** Every platform, so any location can be pointed at it. */
	readonly platforms: readonly PushPlatform[] = ['webpush', 'fcm', 'apns'];

	/**
	 * Refuse every message with a bare string.
	 *
	 * @throws Always, a string.
	 */
	async send(): Promise<PushResult> {
		// 1. Not an `Error` on purpose: pino would take a string for the message and drop the location from the line
		throw 'rate limited';
	}
}

/**
 * Register the fake drivers and the given locations on the process-wide manager.
 *
 * @param locations - Location name to driver name.
 */
const register = (locations: Record<string, 'ok-web' | 'ok-token' | 'down' | 'gone' | 'rude'>): void => {
	// 1. Every driver is always known; the test decides which locations exist
	const manager = usePush();

	manager.registerDriver('ok-web', okDriver(['webpush']));
	manager.registerDriver('ok-token', okDriver(['fcm', 'apns']));
	manager.registerDriver('down', DownDriver);
	manager.registerDriver('gone', GoneDriver);
	manager.registerDriver('rude', RudeDriver);

	for (const [name, driver] of Object.entries(locations)) {
		manager.registerLocation(name, {
			driver,
			options: {},
		});
	}
};

/**
 * A browser subscription with everything `platformOf()` checks for.
 */
const subscription = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };

/**
 * A web push message most tests send.
 */
const message: PushMessage = { subscription, title: 'Paid', body: 'Invoice #1', url: '/billing' };

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(logger as any);
	vi.mocked(useEmitter).mockReturnValue(emitter as any);
});

afterEach(() => {
	usePush.reset();
	sent.length = 0;
	vi.clearAllMocks();
});

describe('sendPush', () => {
	test('Sends through the location named after the platform and emits push.sent', async () => {
		register({ webpush: 'ok-web' });

		const result = await sendPush(message);

		// 1. The answer names the location and the platform that delivered, on top of what the driver said
		expect(result).toStrictEqual({ messageId: 'ok-1', status: 'accepted', location: 'webpush', platform: 'webpush' });
		expect(sent[0]).toBe(message);

		// 2. The filter ran before, the action after, with the target and the title for a listener's log
		expect(emitter.emitFilter).toHaveBeenCalledWith(PUSH_SEND_FILTER, message, { platform: 'webpush' });

		expect(emitter.emitAction).toHaveBeenCalledWith(PUSH_SENT_EVENT, {
			...result,
			target: subscription.endpoint,
			title: 'Paid',
		});
	});

	test('Follows the routes, then the message, then the option', async () => {
		register({ web: 'ok-web', android: 'ok-token', other: 'ok-token' });
		usePush().registerRoutes({ webpush: 'web', fcm: 'android' });

		// 1. The route of the platform: a subscription goes to `web`, a token to `android`
		expect((await sendPush(message))?.location).toBe('web');
		expect((await sendPush({ token: 'tok', title: 'Hi' }))?.location).toBe('android');

		// 2. The message's own location wins over the route, the option over both
		expect((await sendPush({ token: 'tok', title: 'Hi', location: 'other' }))?.location).toBe('other');

		expect((await sendPush({ token: 'tok', title: 'Hi', location: 'other' }, { location: 'android' }))?.location).toBe(
			'android',
		);
	});

	test('Refuses a message without a title or a target before any driver runs', async () => {
		register({ webpush: 'ok-web' });

		// 1. A blank title and a missing target are both the payload's fault
		await expect(sendPush({ subscription, title: ' ' })).rejects.toThrow(InvalidPayloadError);
		await expect(sendPush({ title: 'Hi' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });

		// 2. Refused before the filter, so no handler and no driver ever sees it
		expect(sent).toHaveLength(0);
		expect(emitter.emitFilter).not.toHaveBeenCalled();
	});

	test('Refuses a location that does not exist or does not deliver to the platform', async () => {
		register({ webpush: 'ok-web' });

		// 1. No route and no location for the platform of a token
		await expect(sendPush({ token: 'tok', title: 'Hi' })).rejects.toThrow('No push location delivers to fcm');

		// 2. A name nobody registered
		await expect(sendPush(message, { location: 'nope' })).rejects.toThrow('Push location "nope" doesn\'t exist.');

		// 3. A token routed to a web push location is refused before the driver sees it
		await expect(sendPush({ token: 'tok', title: 'Hi', location: 'webpush' })).rejects.toThrow(
			'Push location "webpush" does not deliver to fcm',
		);

		expect(sent).toHaveLength(0);
	});

	test('Lets a filter rewrite or drop the message', async () => {
		register({ webpush: 'ok-web' });

		// 1. A rewrite reaches the driver
		emitter.emitFilter.mockResolvedValueOnce({ ...message, title: '[test] Paid' });
		await sendPush(message);

		expect(sent[0]?.title).toBe('[test] Paid');

		// 2. A veto answers `null` and sends nothing
		emitter.emitFilter.mockResolvedValueOnce(null);

		expect(await sendPush(message)).toBeNull();
		expect(sent).toHaveLength(1);
	});

	test('Routes a rewritten message by its own target, not by the original one', async () => {
		register({ web: 'ok-web', android: 'ok-token' });
		usePush().registerRoutes({ webpush: 'web', fcm: 'android' });

		// 1. A redirect to a test phone: the filter still hears the incoming platform, the send goes to the token
		//    location, and the events carry the phone's token
		const redirected: PushMessage = { token: 'dev-phone', title: 'Hi' };
		emitter.emitFilter.mockResolvedValueOnce(redirected);

		const result = await sendPush(message);

		expect(emitter.emitFilter).toHaveBeenCalledWith(PUSH_SEND_FILTER, message, { platform: 'webpush' });
		expect(result).toStrictEqual({ messageId: 'ok-1', status: 'accepted', location: 'android', platform: 'fcm' });
		expect(sent[0]).toBe(redirected);

		expect(emitter.emitAction).toHaveBeenCalledWith(PUSH_SENT_EVENT, {
			...result,
			target: 'dev-phone',
			title: 'Hi',
		});
	});

	test('Refuses a rewrite without a title or a target before any driver runs', async () => {
		register({ webpush: 'ok-web' });

		// 1. A handler that blanked the title or dropped the target made the payload unusable, like the caller would have
		emitter.emitFilter.mockResolvedValueOnce({ ...message, title: ' ' });
		await expect(sendPush(message)).rejects.toThrow(InvalidPayloadError);

		emitter.emitFilter.mockResolvedValueOnce({ title: 'Hi' });
		await expect(sendPush(message)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });

		expect(sent).toHaveLength(0);
		expect(emitter.emitAction).not.toHaveBeenCalled();
	});

	test('Passes a gone target on as is, after push.gone', async () => {
		register({ webpush: 'gone' });

		// 1. The driver's error travels untouched: the caller matches on it to delete the subscription
		await expect(sendPush(message)).rejects.toBeInstanceOf(PushTargetGoneError);

		expect(emitter.emitAction).toHaveBeenCalledWith(PUSH_GONE_EVENT, {
			location: 'webpush',
			platform: 'webpush',
			target: subscription.endpoint,
			reason: '410 from https://push.example',
		});

		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('is gone'));
		expect(logger.warn).not.toHaveBeenCalled();
	});

	test('Does not pass a gone target on as is when a filter redirected the message', async () => {
		register({ webpush: 'ok-web', fcm: 'gone' });

		// 1. A redirect to a test phone whose token expired: the caller's own subscription was never contacted, so the
		//    error it deletes subscriptions on must not reach it; the gone error travels as the cause instead
		emitter.emitFilter.mockResolvedValueOnce({ token: 'dev-phone', title: 'Hi' });

		const error = await sendPush(message).catch((caught: unknown) => caught);

		expect(error).not.toBeInstanceOf(PushTargetGoneError);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).cause).toBeInstanceOf(PushTargetGoneError);

		// 2. push.gone still names the token that is actually gone, for a listener that cleans up test devices
		expect(emitter.emitAction).toHaveBeenCalledWith(PUSH_GONE_EVENT, {
			location: 'fcm',
			platform: 'fcm',
			target: 'dev-phone',
			reason: '410 from https://push.example',
		});

		// 3. A rewrite that keeps the target (a title prefix) still passes the error on as is
		emitter.emitFilter.mockResolvedValueOnce({ ...message, title: '[test] Paid' });
		usePush().registerRoutes({ webpush: 'fcm' });

		await expect(sendPush(message)).rejects.toBeInstanceOf(PushTargetGoneError);
	});

	test('Wraps any other failure, after push.failed', async () => {
		register({ webpush: 'down' });

		// 1. The push service's error is the cause of the one thrown
		await expect(sendPush(message)).rejects.toMatchObject({
			message: 'Push location "webpush" failed to send',
			cause: expect.objectContaining({ message: 'push service is down' }),
		});

		expect(emitter.emitAction).toHaveBeenCalledWith(PUSH_FAILED_EVENT, {
			location: 'webpush',
			platform: 'webpush',
			target: subscription.endpoint,
			title: 'Paid',
		});

		expect(logger.warn).toHaveBeenCalledWith(expect.any(Error), expect.stringContaining('failed to send'));
	});

	test('Logs a non-Error rejection as an Error, keeping the location in the line', async () => {
		register({ webpush: 'rude' });

		// 1. The string is wrapped, so pino keeps the kit's line and the location; the raw value stays as the cause
		await expect(sendPush(message)).rejects.toMatchObject({
			message: 'Push location "webpush" failed to send',
			cause: 'rate limited',
		});

		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'rate limited', cause: 'rate limited' }),
			`Push location "webpush" failed to send to ${subscription.endpoint}`,
		);

		expect(logger.warn.mock.calls[0]?.[0]).toBeInstanceOf(Error);
	});
});
