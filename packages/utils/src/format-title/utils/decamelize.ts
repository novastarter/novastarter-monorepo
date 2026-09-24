/**
 * Convert camelCase and PascalCase into lower-case snake_case.
 *
 * Runs of capitals are kept together, so `XMLParser` becomes `xml_parser` rather than `x_m_l_parser`. A digit ends a
 * word only when a capitalized word follows it (`ISO8601Date` -> `iso8601_date`, `MP3Player` -> `mp3_player`); a
 * capital right after a digit with nothing lower-case behind it stays put, so acronyms spelled with a digit (`M2M`,
 * `W3C`, `2FA`) survive as one word.
 *
 * @param string - Text in camelCase, PascalCase or already snake_case.
 * @returns The same text with every word boundary marked by an underscore and all letters lower-cased.
 * @example
 * ```ts
 * decamelize('camelCase');
 * // => 'camel_case'
 * ```
 */
export function decamelize(string: string): string {
	// Put an underscore between a lower-case letter and the capital that follows it (`aB` -> `a_B`)
	// A digit followed by a capital is a boundary only when that capital starts a lower-case word: `1Date` is two
	// words, `2M` in `M2M` is not, since splitting it would break a listed acronym for good
	// Split a run of capitals from a following capitalized word (`XMLParser` -> `XML_Parser`), which the first pass
	// cannot see because both sides are upper-case. The word has to start with a letter: a digit after the capital
	// (`P3` in `MP3`) is part of the run, not a new word
	// Lower-cased, so the caller can re-capitalize each word from a clean base.
	return string
		.replace(/([a-z])([A-Z])/g, '$1_$2')
		.replace(/(\d)([A-Z])(?=[a-z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z]+)/g, '$1_$2')
		.toLowerCase();
}
