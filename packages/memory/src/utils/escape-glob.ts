/**
 * Escape the characters a Redis glob pattern treats as operators, so literal text matches itself in `SCAN MATCH`.
 *
 * A namespace is chosen by the application and may hold `*`, `?`, `[`, `]` or `\`; handed to `MATCH` as is, a
 * `tenant[1]:*` pattern selects `tenant1:…` — another store's keys — and skips `tenant[1]:…`, the store's own. A
 * backslash before each operator turns it back into a literal character.
 *
 * @param text - Literal text to place inside a pattern.
 * @returns The text with every glob operator escaped.
 */
export const escapeGlob = (text: string): string => {
	// `\` goes in the class too, or a namespace ending in a backslash would escape the separator that follows it
	return text.replace(/[\\*?[\]]/g, '\\$&');
};
