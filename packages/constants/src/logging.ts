/**
 * Placeholder written to the logs in place of a secret.
 *
 * Authorization headers, cookies and access tokens are replaced with this text before a log line is written, so a
 * reader still sees that the value was present without the value itself leaking into log storage.
 *
 * @defaultValue `'--redacted--'`
 */
export const REDACTED_TEXT = '--redacted--';
