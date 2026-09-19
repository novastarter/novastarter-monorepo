import { parseJSON } from '@novastarter/utils';

/**
 * Parse a value as JSON, returning it unchanged when it is not valid JSON.
 *
 * This is the last step of type guessing: a plain word such as `production` is not JSON and stays a string, while
 * `{"a":1}` becomes an object.
 *
 * @param value - Raw value.
 * @returns The parsed JSON, or the original value on a parse error.
 */
export const tryJson = (value: unknown): unknown => {
	// 1. Failure is expected for ordinary strings, so the error is swallowed rather than surfaced
	try {
		return parseJSON(String(value)) as unknown;
	} catch {
		return value;
	}
};
