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
	}
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
	readonly platforms: readonly PushPlatform[] = ['webpush', 'fcm', 'apns'];

	/**
	 * Refuse every message.
	 *
	 * @throws Always.
	 */
	async send(): Promise<PushResult> {
		throw new Error('push service is down');
	}
}

/**
 * A driver whose push service says every target is gone.
 */
class GoneDriver implements PushDriver {
	readonly platforms: readonly PushPlatform[] = ['webpush', 'fcm', 'apns'];

	/**
	 * Report the target dead.
	 *
	 * @throws PushTargetGoneError always.
	 */
	async send(): Promise<PushResult> {
		throw new PushTargetGoneError({ platform: 'webpush', reason: '410 from https://push.example' });
	}
}

/**
 * Register the fake drivers and the given locations on the process-wide manager.
 *
 * @param locations - Location name to driver name.
 */
const register = (locations: Record<string, 'ok-web' | 'ok-token' | 'down' | 'gone'>): void => {
	// 1. Every driver is always known; the test decides which locations exist
	const manager = usePush();

	manager.registerDriver('ok-web', okDriver(['webpush']));
	manager.registerDriver('ok-token', okDriver(['fcm', 'apns']));
	manager.registerDriver('down', DownDriver);
	manager.registerDriver('gone', GoneDriver);

	for (const [name, driver] of Object.entries(locations)) {
		manager.registerLocation(name, {
			driver,
			options: {},
		});
	}
};

const subscription = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };
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
});
