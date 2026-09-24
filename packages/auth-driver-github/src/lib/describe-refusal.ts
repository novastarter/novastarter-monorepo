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
	// Only a JSON object can carry the error fields
	const body =
		typeof response.body === 'object' && response.body !== null ? (response.body as Record<string, unknown>) : {};

	const error = body['error'];
	const description = body['error_description'];

	if (typeof error === 'string' && error) {
		return typeof description === 'string' && description ? `${error}: ${description}` : error;
	}

	const message = body['message'];

	if (typeof message === 'string' && message) {
		return `${what} answered ${response.status}: ${message}`;
	}

	return `${what} answered ${response.status}`;
};
