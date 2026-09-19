/**
 * Convert camelCase and PascalCase into lower-case snake_case.
 *
 * Runs of capitals are kept together, so `XMLParser` becomes `xml_parser` rather than `x_m_l_parser`. Digits count as
 * lower-case characters for the purpose of finding a word boundary.
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
	// 1. Put an underscore between a lower-case letter or digit and the capital that follows it (`aB` -> `a_B`)
	// 2. Split a run of capitals from a following capitalized word (`XMLParser` -> `XML_Parser`), which the first
	//    pass cannot see because both sides are upper-case
	// 3. Lower-case everything, so the caller can re-capitalize each word from a clean base
	return string
		.replace(/([a-z\d])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1_$2')
		.toLowerCase();
}
