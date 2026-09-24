import { REDACTED_TEXT } from '@novastarter/constants';

/**
 * Hide the access token in a request path before it reaches the logs.
 *
 * Tokens may be passed as `?access_token=…`, and an HTTP log line that keeps them would be a credential leak.
 *
 * @param originalPath - Path with query string as the request carried it.
 * @returns The same path with the token replaced, or the input untouched when it does not parse as a URL.
 */
export function redactQuery(originalPath: string): string {
	try {
		// A base is required for relative paths; only pathname and search are read back, so its value is irrelevant.
		const url = new URL(originalPath, 'http://example.com/');

		// Only the token is sensitive; every other parameter stays useful for debugging.
		if (url.searchParams.has('access_token')) {
			url.searchParams.set('access_token', REDACTED_TEXT);
		}

		return url.pathname + url.search;
	} catch {
		// An unparseable path is logged as is rather than dropping the log line.
		return originalPath;
	}
}
