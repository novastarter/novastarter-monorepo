import type { ProviderResponse } from './request.js';

/**
 * Put a refused response into one line: the OAuth `error` and its description when the body has them, else the status.
 *
 * OAuth endpoints answer a refusal with `{ "error": "invalid_grant", "error_description": "…" }`, and the `error` is
 * what tells a spent code from a wrong secret, so it leads the line.
 *
 * @param what - What was asked, for the line without an OAuth error: `the token endpoint`.
 * @param response - The refused response.
 * @returns The reason to put into an `AuthProviderFailedError`.
 * @example
 * ```ts
 * describeRefusal('the token endpoint', { status: 400, ok: false, body: { error: 'invalid_grant' } });
 * // => 'invalid_grant'
 * ```
 */
export const describeRefusal = (what: string, response: ProviderResponse): string => {
	// 1. Only a JSON object can carry the OAuth fields; anything else falls through to the status
	const body =
		typeof response.body === 'object' && response.body !== null ? (response.body as Record<string, unknown>) : {};

	const error = body['error'];
	const description = body['error_description'];

	// 2. The error code first, the prose after it, when Google sent both
	if (typeof error === 'string' && error) {
		return typeof description === 'string' && description ? `${error}: ${description}` : error;
	}

	// 3. No OAuth error: the status is all there is to report
	return `${what} answered ${response.status}`;
};
