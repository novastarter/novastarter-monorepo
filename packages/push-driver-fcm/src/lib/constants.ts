/**
 * FCM error codes that mean the token is dead — what Firebase says to delete the token on.
 *
 * @defaultValue `messaging/registration-token-not-registered`, `messaging/invalid-registration-token`
 */
export const GONE_CODES: ReadonlySet<string> = new Set([
	'messaging/registration-token-not-registered',
	'messaging/invalid-registration-token',
]);
