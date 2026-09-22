import type { ProviderResponse } from './request.js';

/**
 * Put a refused response into one line: the OAuth `error` and its description, or the REST API's `message`, when the
 * body has them, else the status.
 *
 * The OAuth endpoints answer a refusal with `{ "error": "bad_verification_code", "error_description": "…" }`, and the
 * `error` is what tells a spent code from a wrong secret, so it leads the line. The REST API answers with
 * `{ "message": "Bad credentials" }` instead.
 *
 * @param what - What was asked, for the line without an OAuth error: `the token endpoint`.
 * @param response - The refused response.
 * @returns The reason to put into an `AuthProviderFailedError`.
 * @example
 * ```ts
 * describeRefusal('the token endpoint', { status: 200, ok: true, body: { error: 'bad_verification_code' } });
 * // => 'bad_verification_code'
 * ```
 */
export const describeRefusal = (what: string, response: ProviderResponse): string => {
	// 1. Only a JSON object can carry the error fields; anything else falls through to the status
	const body =
		typeof response.body === 'object' && response.body !== null ? (response.body as Record<string, unknown>) : {};

	const error = body['error'];
	const description = body['error_description'];

	// 2. The error code first, the prose after it, when GitHub sent both
	if (typeof error === 'string' && error) {
		return typeof description === 'string' && description ? `${error}: ${description}` : error;
	}

	// 3. The REST API's own shape: the status and its message
	const message = body['message'];

	if (typeof message === 'string' && message) {
		return `${what} answered ${response.status}: ${message}`;
	}

	// 4. Neither: the status is all there is to report
	return `${what} answered ${response.status}`;
};
