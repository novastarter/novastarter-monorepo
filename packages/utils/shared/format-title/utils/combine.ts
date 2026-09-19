/**
 * Join two strings with a single space.
 *
 * Shaped as a reducer callback: `words.reduce(combine)` folds a word list back into a sentence once every word has
 * been cased.
 *
 * @param acc - Text accumulated so far.
 * @param str - Next word to append.
 * @returns `acc` followed by a space and `str`.
 * @example
 * ```ts
 * ['Hello', 'World'].reduce(combine);
 * // => 'Hello World'
 * ```
 */
export function combine(acc: string, str: string): string {
	// 1. A plain space is the only separator; it is what a later `split` on whitespace expects back
	return `${acc} ${str}`;
}
