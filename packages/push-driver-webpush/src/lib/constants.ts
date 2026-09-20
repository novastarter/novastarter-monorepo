/**
 * HTTP statuses a push service answers for a subscription that no longer exists.
 *
 * @defaultValue 404 (Firefox, Safari), 410 (Chrome, Edge)
 */
export const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

/**
 * Longest topic a push service takes (RFC 8030 §5.4).
 *
 * @defaultValue 32
 */
export const TOPIC_MAX_LENGTH = 32;

/**
 * The origin every push service answers — used to sign a test token in {@link PushDriverWebPush.verify}.
 *
 * @defaultValue `https://fcm.googleapis.com`
 */
export const VERIFY_AUDIENCE = 'https://fcm.googleapis.com';
