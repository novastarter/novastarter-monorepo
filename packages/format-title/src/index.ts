import { capitalize } from './utils/capitalize.js';
import { combine } from './utils/combine.js';
import { decamelize } from './utils/decamelize.js';
import { handleSpecialWords } from './utils/handle-special-words.js';

/**
 * Convert any string into Title Case.
 *
 * The input is first decamelized, so camelCase and PascalCase get the same word boundaries as snake_case or a plain
 * sentence. It is then split on the separator, every word is capitalized, minor words and known acronyms or brand
 * spellings are fixed up per word, and the words are joined back with single spaces.
 *
 * @param title - Text in camelCase, PascalCase, snake_case, kebab-case or a regular sentence.
 * @param separator - Regex the decamelized text is split on; defaults to whitespace, `-` and `_`.
 * @returns The title-cased text.
 * @example
 * ```ts
 * formatTitle('snowWhiteAndTheSevenDwarfs');
 * // => 'Snow White and the Seven Dwarfs'
 * ```
 */
export function formatTitle(title: string, separator: RegExp = new RegExp('\\s|-|_', 'g')): string {
	// 1. Decamelize before splitting, so the separator regex only has to know about explicit delimiters
	return decamelize(title).split(separator).map(capitalize).map(handleSpecialWords).reduce(combine);
}

/**
 * Default export mirroring {@link formatTitle}, kept so both import styles work.
 */
export default formatTitle;
