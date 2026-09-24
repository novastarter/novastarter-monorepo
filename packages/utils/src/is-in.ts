/**
 * Check whether a string is one of the members of a readonly string tuple, narrowing its type on success.
 *
 * `Array.prototype.includes` on an `as const` tuple rejects a plain `string` argument; this wrapper performs the same
 * check and acts as a type guard, so the caller gets the union type of the tuple afterwards.
 *
 * @typeParam T - The readonly string tuple to test against.
 * @param value - Any string.
 * @param array - Tuple of allowed values.
 * @returns `true` when `value` is a member of `array`.
 * @example
 * ```ts
 * const EXTS = ['js', 'mjs'] as const;
 *
 * if (isIn(ext, EXTS)) {
 *     // `ext` is now typed as 'js' | 'mjs'
 * }
 * ```
 */
export function isIn<T extends readonly string[]>(value: string, array: T): value is T[number] {
	// The tuple is widened to `readonly string[]` here, so any string can be looked up
	return array.includes(value);
}
