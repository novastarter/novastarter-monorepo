import { Errors } from 'apns2';

/**
 * APNs reasons that mean the device token is dead: the app was deleted, the token belongs to another app, or the
 * token never was one.
 *
 * @defaultValue `Unregistered`, `BadDeviceToken`, `DeviceTokenNotForTopic`
 */
export const GONE_REASONS: ReadonlySet<string> = new Set([
	Errors.unregistered,
	Errors.badDeviceToken,
	Errors.deviceTokenNotForTopic,
]);
