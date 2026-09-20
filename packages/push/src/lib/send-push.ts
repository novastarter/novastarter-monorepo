import { useEmitter } from '@novastarter/emitter';
import { InvalidPayloadError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { PushTargetGoneError } from '../errors/index.js';
import type { PushMessage, PushPlatform, PushResult } from '../types.js';
import { platformOf } from './platform-of.js';
import type { PushManager } from './push-manager.js';
import { usePush } from './use-push.js';

/**
 * Filter event a message passes through before it is sent; a handler may change it or return `null` to drop it.
 *
 * @defaultValue `push.send`
 */
export const PUSH_SEND_FILTER = 'push.send';

/**
 * Action event after the push service accepted a message.
 *
 * @defaultValue `push.sent`
 */
export const PUSH_SENT_EVENT = 'push.sent';

/**
 * Action event after the push service refused a message or could not be reached.
 *
 * @defaultValue `push.failed`
 */
export const PUSH_FAILED_EVENT = 'push.failed';

/**
 * Action event after the push service reported the target gone — what a listener deletes the stored subscription on.
 *
 * @defaultValue `push.gone`
 */
export const PUSH_GONE_EVENT = 'push.gone';

/**
 * What {@link sendPush} answers: the driver's result, and which location and platform delivered.
 */
export interface PushSendResult extends PushResult {
	location: string;
	platform: PushPlatform;
}

/**
 * Per-call overrides of {@link sendPush}.
 */
export interface PushSendOptions {
	/** Send through this location only, ignoring the message's `location` and the routes. */
	location?: string | undefined;
}

/**
 * Send a message: validate its target, route it to the location of the target's platform and send it once.
 *
 * The one entry point for outgoing pushes, on the `PushManager` of `usePush()`. What it does for every message:
 *
 * 1. Refuses a message without a title, without a target, with both targets, or with a subscription missing its
 *    endpoint or keys.
 * 2. Runs the `push.send` filter, so the app can rewrite or drop it.
 * 3. Picks the location: the option, else the message's own, else the route of the platform, else the location named
 *    after the platform. There is no fallback chain — a subscription is bound to one key pair, a token to one project.
 * 4. Sends, and emits `push.sent` with the result, `push.gone` when the target is dead, or `push.failed` and throws.
 *
 * @param message - Message to send; `location` is optional.
 * @param options - Per-call overrides.
 * @returns The driver's result with the location and platform that delivered, or `null` when a `push.send` filter
 * dropped the message.
 * @throws InvalidPayloadError for a message without a title, without a target, or with an unusable subscription.
 * @throws PushTargetGoneError when the target no longer exists — delete it, do not retry.
 * @throws Error when no location delivers to the target's platform, when the chosen location does not, or when the
 * push service refused or could not be reached, the driver's error as `cause`.
 *
 * @example
 * ```ts
 * const result = await sendPush({
 * 	subscription,
 * 	title: 'Invoice paid',
 * 	body: 'Invoice #1042 — $49.00',
 * 	url: '/dashboard/billing/invoices',
 * 	tag: 'invoice-1042',
 * });
 * // → { location: 'webpush', platform: 'webpush', status: '201' }
 * ```
 */
export const sendPush = async (message: PushMessage, options: PushSendOptions = {}): Promise<PushSendResult | null> => {
	const manager = usePush();
	const logger = useLogger();

	// 1. A notification without a title shows as an empty box; the target is checked before any work is done
	if (typeof message.title !== 'string' || !message.title.trim()) {
		throw new InvalidPayloadError({ reason: 'The push message has no title' });
	}

	const platform = platformOf(message);

	// 2. A filter handler may rewrite the message — a prefix, a redirect to a test device — or veto it
	const prepared = await useEmitter().emitFilter<PushMessage | null>(PUSH_SEND_FILTER, message, { platform });

	if (!prepared) return null;

	// 3. One location, resolved for the platform; a token cannot go through a web push location, so a wrong one is
	//    refused rather than tried
	const location = resolveLocation(manager, options.location ?? prepared.location, platform);
	const driver = manager.location(location);

	if (!driver.platforms.includes(platform)) {
		throw new Error(`Push location "${location}" does not deliver to ${platform}`);
	}

	const target = platform === 'webpush' ? prepared.subscription?.endpoint : prepared.token;

	try {
		const result = await driver.send(prepared);
		const sent: PushSendResult = { ...result, location, platform };

		useEmitter().emitAction(PUSH_SENT_EVENT, { ...sent, target, title: prepared.title });

		return sent;
	} catch (error) {
		// 4. A gone target is not a failure to retry: reported as its own event and passed on as is
		if (error instanceof PushTargetGoneError) {
			logger.info(`Push target on "${location}" is gone (${error.extensions.reason}): ${target}`);
			useEmitter().emitAction(PUSH_GONE_EVENT, { location, platform, target, reason: error.extensions.reason });

			throw error;
		}

		// 5. Anything else is the push service refusing or being unreachable; the driver's error travels as the cause
		logger.warn(error, `Push location "${location}" failed to send to ${target}`);
		useEmitter().emitAction(PUSH_FAILED_EVENT, { location, platform, target, title: prepared.title });

		throw new Error(`Push location "${location}" failed to send`, { cause: error });
	}
};

/**
 * The location a message goes through.
 *
 * @param manager - The manager with the locations and routes.
 * @param named - The location the call or the message asked for, when any.
 * @param platform - The target's platform.
 * @returns The location name.
 * @throws Error when the named location does not exist, or when no route and no location of the platform's name
 * serves the platform.
 */
const resolveLocation = (manager: PushManager, named: string | undefined, platform: PushPlatform): string => {
	// 1. An explicit location wins; a name nobody registered is a configuration mistake worth naming
	if (named) {
		if (!manager.hasLocation(named)) {
			throw new Error(`Push location "${named}" doesn't exist.`);
		}

		return named;
	}

	// 2. The route of the platform, else the location named after it — the one-location-per-platform setup needs no
	//    routes at all
	const location = manager.routes()[platform] ?? platform;

	if (!manager.hasLocation(location)) {
		throw new Error(`No push location delivers to ${platform}`);
	}

	return location;
};
