import acronyms from '../constants/acronyms.js';
import articles from '../constants/articles.js';
import conjunctions from '../constants/conjunctions.js';
import prepositions from '../constants/prepositions.js';
import specialCase from '../constants/special-case.js';

/**
 * Apply title-case rules to a single word based on its position in the sentence.
 *
 * See https://apastyle.apa.org/style-grammar-guidelines/capitalization/title-case for the rules. Shaped as a `map`
 * callback, so it receives the word, its index and the whole word list. The word is expected to be capitalized
 * already; this function only lower-cases minor words or swaps in a fixed spelling.
 *
 * @param str - Capitalized word to check.
 * @param index - Position of the word in the sentence.
 * @param words - All words of the sentence, used to detect the last word.
 * @returns The word with its final casing.
 * @example
 * ```ts
 * handleSpecialWords('To', 1, ['Go', 'To', 'Sleep']);
 * // => 'to'
 * ```
 */
export function handleSpecialWords(str: string, index: number, words: string[]): string {
	const lowercaseStr = str.toLowerCase();
	const uppercaseStr = str.toUpperCase();

	// 1. A word with a fixed brand spelling (`iPhone`, `MySQL`) always uses that spelling, whatever its position
	for (const special of specialCase) {
		if (special.toLowerCase() === lowercaseStr) return special;
	}

	// 2. A known acronym is always fully upper-cased
	if (acronyms.includes(uppercaseStr)) return uppercaseStr;

	// 3. The first word stays capitalized even if it is a minor word (`The Cat`)
	if (index === 0) return str;

	// 4. The last word stays capitalized for the same reason (`Come In`)
	if (index === words.length - 1) return str;

	// 5. Minor words are lower-cased only when short; four characters or more keeps the capital (`Whether`)
	if (str.length >= 4) return str;

	// 6. Short prepositions, conjunctions and articles in the middle of the sentence are lower-cased
	if (prepositions.includes(lowercaseStr)) return lowercaseStr;
	if (conjunctions.includes(lowercaseStr)) return lowercaseStr;
	if (articles.includes(lowercaseStr)) return lowercaseStr;

	// 7. Anything else keeps the capital it arrived with
	return str;
}
