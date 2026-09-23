/**
 * FCM error codes that mean the token is dead — what Firebase says to delete the token on.
 *
 * @defaultValue `messaging/registration-token-not-registered`, `messaging/invalid-registration-token`
 */
export const GONE_CODES: ReadonlySet<string> = new Set([
	'messaging/registration-token-not-registered',
	'messaging/invalid-registration-token',
]);

/**
 * The root a {@link PushDriverFcm.call} path is joined to.
 *
 * @defaultValue `https://fcm.googleapis.com`
 */
export const FCM_API_URL = 'https://fcm.googleapis.com';

/**
 * Hosts a full URL of {@link PushDriverFcm.call} may point at besides {@link FCM_API_URL}'s: the Instance ID API,
 * where topic subscriptions are managed. No other host receives the service account's access token.
 *
 * @defaultValue `fcm.googleapis.com`, `iid.googleapis.com`
 * @internal
 */
export const FCM_CALL_HOSTS: readonly string[] = ['fcm.googleapis.com', 'iid.googleapis.com'];
