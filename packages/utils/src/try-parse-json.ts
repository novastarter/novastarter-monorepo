import { parseJSON } from './parse-json.js';

/**
 * Parse JSON text, answering with a fallback instead of throwing when the text is not JSON.
 *
 * The same prototype-safe parse as {@link parseJSON}; only a `SyntaxError` — the text is not JSON — is turned into
 * the fallback, so a plain word such as `production` stays whatever the caller passes as `fallback` while `{"a":1}`
 * becomes an object. Any other error is still thrown.
 *
 * Two overloads, so `tryParseJSON<Config>(text, defaults)` type-checks: with an explicit `T` the fallback's type
 * defaults to `T` instead of being lost, and without a fallback the answer is `T | undefined`.
 *
 * @typeParam T - Type the caller expects the parsed value to be.
 * @typeParam F - Type of the fallback; `T` unless given.
 * @param input - JSON text, or any text.
 * @param fallback - What to answer with when `input` is not valid JSON.
 * @returns The parsed value, or `fallback`; `undefined` when no fallback is given.
 * @example
 * ```ts
 * tryParseJSON('{"a":1}');
 * // => { a: 1 }
 *
 * tryParseJSON('production', 'production');
 * // => 'production'
 *
 * tryParseJSON('nope');
 * // => undefined
 * ```
 */
export function tryParseJSON<T = unknown>(input: string): T | undefined;
export function tryParseJSON<T = unknown, F = T>(input: string, fallback: F): T | F;
export function tryParseJSON(input: string, fallback?: unknown): unknown {
	// 1. Failure is the expected outcome for ordinary text, so it is caught rather than surfaced
	try {
		return parseJSON(input) as unknown;
	} catch (error) {
		// 2. Only "not JSON" maps to the fallback; anything else is a real fault the caller has to see
		if (error instanceof SyntaxError) {
			return fallback;
		}

		throw error;
	}
}
