/**
 * Upper-case the first character of a word and leave the rest untouched.
 *
 * Only the first character changes, so a word that is already upper-cased (an acronym such as `TEST`) keeps its
 * casing instead of being turned into `Test`.
 *
 * @param word - Word to capitalize; may be empty.
 * @returns The word with its first character upper-cased.
 * @example
 * ```ts
 * capitalize('test');
 * // => 'Test'
 * ```
 */
export function capitalize(word: string): string {
	// 1. `charAt` returns an empty string past the end, so an empty word passes through without throwing
	return word.charAt(0).toUpperCase() + word.substring(1);
}
