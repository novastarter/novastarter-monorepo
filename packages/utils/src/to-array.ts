/**
 * Wrap a value in an array, splitting a string on commas.
 *
 * Environment variables and query parameters arrive as comma-separated strings, while programmatic callers pass real
 * arrays or single values; this helper lets the rest of the code treat all three the same way.
 *
 * @typeParam T - Element type of the resulting array.
 * @param val - A single value, an array, or a comma-separated string.
 * @returns The value as an array. An array input is returned as the same instance, not a copy.
 * @example
 * ```ts
 * toArray('a,b,c');
 * // => ['a', 'b', 'c']
 *
 * toArray(1);
 * // => [1]
 * ```
 */
export function toArray<T = unknown>(val: T | T[]): T[] {
	// A string is treated as a comma-separated list, so `LIST=a,b` in an env file becomes `['a', 'b']`
	if (typeof val === 'string') {
		return val.split(',') as unknown as T[];
	}

	return Array.isArray(val) ? val : [val];
}
