import { useEmitter } from '@novastarter/emitter';
import { InvalidConfigError, InvalidPayloadError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { toError } from '@novastarter/utils';
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
 * 2. Runs the `push.send` filter, so the app can rewrite or drop it. The rewrite is checked the same way and routed
 *    by its own target, so a redirect to a test phone goes through the token location, not the original one.
 * 3. Picks the location: the option, else the message's own, else the route of the platform, else the location named
 *    after the platform. There is no fallback chain — a subscription is bound to one key pair, a token to one project.
 * 4. Sends, and emits `push.sent` with the result, `push.gone` when the target is dead, or `push.failed` and throws.
 *    A `PushTargetGoneError` is passed on only when the dead target is the one the caller sent to; when a handler
 *    redirected the message to another target, it travels as the `cause` of a plain `Error` instead, so a caller
 *    deleting its own subscription on that error does not delete one that was never contacted.
 *
 * @param message - Message to send; `location` is optional.
 * @param options - Per-call overrides.
 * @returns The driver's result with the location and platform that delivered, or `null` when a `push.send` filter
 * dropped the message.
 * @throws InvalidPayloadError for a message without a title, without a target, or with an unusable subscription — as
 * it came in, or as a `push.send` handler rewrote it.
 * @throws PushTargetGoneError when the caller's own target no longer exists — delete it, do not retry.
 * @throws InvalidConfigError when the named location is not registered, when no location delivers to the target's
 * platform, or when the chosen location does not.
 * @throws Error when the push service refused or could not be reached, the driver's error as `cause`; also when a
 * `push.send` handler redirected the message to another target and that one is gone, the `PushTargetGoneError` as
 * `cause`.
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

	// Checked before any work is done, so a broken message never reaches a handler
	assertTitle(message);

	const incoming = platformOf(message);

	// Read before any handler runs: a handler may rewrite the message in place and return nothing, and the target read
	// afterwards would then be the redirected one, not the caller's
	const originalTarget = targetOf(message, incoming);

	// A filter handler may rewrite the message (a prefix, a redirect to a test device) or veto it; the meta names the
	// platform the message came in with
	const prepared = await useEmitter().emitFilter<PushMessage | null>(PUSH_SEND_FILTER, message, {
		platform: incoming,
	});

	if (!prepared) return null;

	// The rewrite is checked and routed by its own target, not by the original's: a redirect to a test phone has to go
	// through the token location, and a handler that dropped the target or blanked the title is refused here rather than
	// by a driver of the wrong platform
	assertTitle(prepared);

	const platform = platformOf(prepared);

	// A token cannot go through a web push location, so a wrong one is refused rather than tried
	const location = resolveLocation(manager, options.location ?? prepared.location, platform);
	const driver = manager.location(location);

	if (!driver.platforms.includes(platform)) {
		throw new InvalidConfigError({
			reason: `Push location "${location}" does not deliver to ${platform}; route ${platform} to a location that does`,
		});
	}

	// `push.sent` carries the target and the title, so a listener can log without re-deriving them
	const target = targetOf(prepared, platform);

	try {
		const result = await driver.send(prepared);
		const sent: PushSendResult = { ...result, location, platform };

		useEmitter().emitAction(PUSH_SENT_EVENT, { ...sent, target, title: prepared.title });

		return sent;
	} catch (error) {
		// A gone target is not a failure to retry: it is reported as its own event, which carries the target that was
		// actually contacted
		if (error instanceof PushTargetGoneError) {
			logger.info(`Push target on "${location}" is gone (${error.extensions.reason}): ${target}`);
			useEmitter().emitAction(PUSH_GONE_EVENT, { location, platform, target, reason: error.extensions.reason });

			// The error itself carries no target, and callers delete the subscription they passed in when they catch it; so
			// it is passed on as is only when that subscription is the one that is gone. A redirect to a test device whose
			// token expired must not make the caller delete the real user's subscription
			if (target === originalTarget) {
				throw error;
			}

			throw new Error(`Push target "${target}" a push.send handler redirected to on "${location}" is gone`, {
				cause: error,
			});
		}

		// Anything else is the push service refusing or being unreachable; the driver's error travels as the cause. pino
		// takes a non-object first argument as the message, so a driver rejecting with a string would replace the line and
		// drop the location; `toError` keeps both
		logger.warn(toError(error), `Push location "${location}" failed to send to ${target}`);
		useEmitter().emitAction(PUSH_FAILED_EVENT, { location, platform, target, title: prepared.title });

		throw new Error(`Push location "${location}" failed to send`, { cause: error });
	}
};

/**
 * The target of a message: the subscription's endpoint for web push, the token otherwise.
 *
 * @param message - The message, already checked by {@link platformOf}.
 * @param platform - The platform {@link platformOf} answered for it.
 * @returns The endpoint or the token.
 * @internal
 */
const targetOf = (message: PushMessage, platform: PushPlatform): string | undefined =>
	// `platformOf()` guarantees the one target the platform implies is present
	platform === 'webpush' ? message.subscription?.endpoint : message.token;

/**
 * Refuse a message whose title is missing or blank.
 *
 * @param message - The message, as it came in or as a `push.send` handler rewrote it.
 * @throws InvalidPayloadError for a title that is not a string or is whitespace only.
 */
const assertTitle = (message: PushMessage): void => {
	// A notification without a title shows as an empty box on every platform
	if (typeof message.title !== 'string' || !message.title.trim()) {
		throw new InvalidPayloadError({ reason: 'The push message has no title' });
	}
};

/**
 * The location a message goes through.
 *
 * @param manager - The manager with the locations and routes.
 * @param named - The location the call or the message asked for, when any.
 * @param platform - The target's platform.
 * @returns The location name.
 * @throws InvalidConfigError when the named location does not exist, or when no route and no location of the
 * platform's name serves the platform.
 */
const resolveLocation = (manager: PushManager, named: string | undefined, platform: PushPlatform): string => {
	// A name nobody registered is a configuration mistake worth naming
	if (named) {
		if (!manager.hasLocation(named)) {
			throw new InvalidConfigError({
				reason: `Push location "${named}" doesn't exist; register it or name another one`,
			});
		}

		return named;
	}

	// Falling back to the location named after the platform means the one-location-per-platform setup needs no routes at
	// all
	const location = manager.routes()[platform] ?? platform;

	if (!manager.hasLocation(location)) {
		throw new InvalidConfigError({
			reason: `No push location delivers to ${platform}; register a location named "${platform}" or route ${platform} to one`,
		});
	}

	return location;
};
