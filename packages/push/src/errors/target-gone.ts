import { createError, type NovastarterErrorConstructor } from '@novastarter/errors';
import type { PushPlatform } from '../types.js';

/**
 * Context of {@link PushTargetGoneError}.
 */
export interface PushTargetGoneErrorExtensions {
	/** The platform of the target that is gone. */
	platform: PushPlatform;
	/** What the push service said: the HTTP status for web push, the error code for FCM, the reason for APNs. */
	reason: string;
}

/**
 * Thrown by a driver when the push service reports the target no longer exists: the browser unsubscribed or the
 * subscription expired (`404` / `410` from the push service), the app was uninstalled or the token rotated
 * (`registration-token-not-registered` from FCM, `Unregistered` from APNs).
 *
 * Not a failure to retry — the stored subscription is dead and the caller removes it. Status 410, since that is
 * what it is.
 *
 * `sendPush()` passes it on only when the dead target is the one the caller sent to; when a `push.send` handler
 * redirected the message elsewhere, it arrives as the `cause` of a plain `Error`, so the pattern below is safe.
 *
 * @example
 * ```ts
 * try {
 * 	await sendPush({
 * 		subscription,
 * 		title: 'Hi',
 * 	});
 * } catch (error) {
 * 	if (error instanceof PushTargetGoneError) await deleteSubscription(subscription.endpoint);
 * }
 * ```
 */
export const PushTargetGoneError: NovastarterErrorConstructor<PushTargetGoneErrorExtensions> =
	createError<PushTargetGoneErrorExtensions>(
		'PUSH_TARGET_GONE',
		({ platform, reason }) => `The ${platform} push target is gone: ${reason}`,
		410,
	);
