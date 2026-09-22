/**
 * Parse JSON while dropping `__proto__` keys, so untrusted input cannot pollute `Object.prototype`.
 *
 * `JSON.parse` with a reviver is noticeably slower than the plain call, so the reviver is only attached when the raw
 * text can carry the key at all: it contains the substring `__proto__`, or a `\u` escape that could spell it out
 * character by character (`"\u005f_proto__"`).
 *
 * @param input - JSON text.
 * @returns The parsed value.
 * @throws `SyntaxError` when `input` is not valid JSON.
 * @example
 * ```ts
 * parseJSON('{"__proto__": {"admin": true}, "name": "x"}');
 * // => { name: 'x' } — the prototype key is gone
 * ```
 */
export function parseJSON(input: string): any {
	// 1. Only pay for the reviver when the text can carry a prototype key at all: spelled out, or hidden behind
	//    unicode escapes that `JSON.parse` resolves before the key is compared
	const text = String(input);

	if (text.includes('__proto__') || text.includes('\\u')) {
		return JSON.parse(text, noproto);
	}

	// 2. Fast path for the common, harmless case
	return JSON.parse(input);
}

/**
 * `JSON.parse` reviver that removes `__proto__` keys at any nesting level.
 *
 * Returning `undefined` from a reviver deletes the key from the result, which is how the prototype key is dropped.
 *
 * @typeParam T - Type of the value being revived.
 * @param key - Property name being revived.
 * @param value - Property value being revived.
 * @returns The value unchanged, or `undefined` for a `__proto__` key.
 */
export function noproto<T>(key: string, value: T): T | void {
	// 1. Every key except the dangerous one passes through untouched
	if (key !== '__proto__') {
		return value;
	}
}
