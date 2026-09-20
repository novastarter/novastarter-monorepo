/**
 * Convert an environment variable value to a boolean.
 *
 * Only `'true'`, `true`, `'1'` and `1` count as truthy; every other value, including `'yes'` or a non-empty string, is
 * `false`. This keeps a misspelt flag from silently enabling a feature.
 *
 * @param value - Raw value from the environment or a config file.
 * @returns `true` for the four accepted truthy spellings, `false` otherwise.
 * @example
 * ```ts
 * toBoolean('1');
 * // => true
 *
 * toBoolean('yes');
 * // => false
 * ```
 */
export function toBoolean(value: any): boolean {
	// 1. Compare against the accepted spellings explicitly instead of coercing, so `'false'` cannot come out truthy
	return value === 'true' || value === true || value === '1' || value === 1;
}
