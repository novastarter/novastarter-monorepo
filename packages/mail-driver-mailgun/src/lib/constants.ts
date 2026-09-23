/**
 * API host used when the location names none.
 *
 * @defaultValue `api.mailgun.net`, the US region.
 */
export const DEFAULT_MAILGUN_HOST = 'api.mailgun.net';

/**
 * How long a `call()` request may take when neither the caller nor the location's `timeout` names one, in milliseconds.
 *
 * @defaultValue 30 000 ms.
 */
export const DEFAULT_MAILGUN_CALL_TIMEOUT = 30_000;
