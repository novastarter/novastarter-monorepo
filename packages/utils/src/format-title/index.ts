import { capitalize } from './utils/capitalize.js';
import { decamelize } from './utils/decamelize.js';
import { handleSpecialWords } from './utils/handle-special-words.js';

/**
 * Convert any string into Title Case.
 *
 * The input is first decamelized, so camelCase and PascalCase get the same word boundaries as snake_case or a plain
 * sentence. It is then split on the separator, every word is capitalized, minor words and known acronyms or brand
 * spellings are fixed up per word, and the words are joined back with single spaces. Repeated, leading and trailing
 * separators produce no empty words, so the result never carries doubled, leading or trailing spaces.
 *
 * @param title - Text in camelCase, PascalCase, snake_case, kebab-case or a regular sentence.
 * @param separator - Regex the decamelized text is split on; defaults to whitespace, `-` and `_`.
 * @returns The title-cased text; an empty string for an input holding nothing but separators.
 * @example
 * ```ts
 * formatTitle('snowWhiteAndTheSevenDwarfs');
 * // => 'Snow White and the Seven Dwarfs'
 * ```
 */
export function formatTitle(title: string, separator: RegExp = new RegExp('\\s|-|_', 'g')): string {
	// Decamelizing before splitting means the separator regex only has to know about explicit delimiters. Consecutive,
	// leading or trailing separators leave empty strings behind; they are dropped, since each would otherwise become a
	// spurious space and could count as the last word, letting a real minor word before it stay lower-cased.
	const words = decamelize(title)
		.split(separator)
		.filter((word) => word !== '');

	// Casing is per word, but the minor-word rules need the position, so the fixed-up list is joined only at the end
	return words.map(capitalize).map(handleSpecialWords).join(' ');
}
