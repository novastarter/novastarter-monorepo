/**
 * Tests of `utils/parse-json`.
 */
import { describe, expect, it } from 'vitest';
import { noproto, parseJSON } from './parse-json.js';

describe('parseJSON', () => {
	it('parses valid JSON object', () => {
		// 1. The plain case takes the fast path: no `__proto__` and no escape in the text, so no reviver runs
		expect(parseJSON('{"key": "value"}')).toEqual({ key: 'value' });
	});

	it('parses valid JSON array', () => {
		// 1. An array is a valid top-level value, not only an object
		expect(parseJSON('[1, 2, 3]')).toEqual([1, 2, 3]);
	});

	it('parses JSON with nested objects', () => {
		// 1. Nesting is left to `JSON.parse`; the wrapper adds nothing that could flatten it
		const input = '{"outer": {"inner": "value"}}';
		expect(parseJSON(input)).toEqual({ outer: { inner: 'value' } });
	});

	it('parses JSON string value', () => {
		// 1. A bare string is JSON too; it must come back unquoted, not wrapped or rejected
		expect(parseJSON('"hello"')).toBe('hello');
	});

	it('parses JSON number value', () => {
		// 1. A bare number is answered with as a number, not as its text
		expect(parseJSON('42')).toBe(42);
	});

	it('parses JSON boolean values', () => {
		// 1. Both literals come back as booleans, so `false` is not confused with a missing value
		expect(parseJSON('true')).toBe(true);
		expect(parseJSON('false')).toBe(false);
	});

	it('parses JSON null value', () => {
		// 1. `null` is a value of its own, distinct from `undefined`, and must survive the parse as such
		expect(parseJSON('null')).toBe(null);
	});

	it('throws on invalid JSON', () => {
		// 1. The `SyntaxError` of `JSON.parse` is passed on; the caller decides whether to fall back
		expect(() => parseJSON('invalid')).toThrow();
	});

	it('throws on empty string', () => {
		// 1. Empty text is not JSON either; answering `undefined` would hide a missing value
		expect(() => parseJSON('')).toThrow();
	});

	it('strips __proto__ property from parsed JSON', () => {
		// 1. The text carries the key, so the reviver path runs and drops it while keeping every other key
		const malicious = '{"__proto__": {"polluted": true}, "safe": "value"}';
		const result = parseJSON(malicious);
		expect(result.safe).toBe('value');

		// 2. An own-property check rather than `in` or `result.__proto__`: those would see `Object.prototype` and
		//    answer `true` for any object
		expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);

		// 3. Had the key gone through, `Object.prototype` itself would now carry `polluted` for every object
		expect(({} as any).polluted).toBeUndefined();
	});

	it('strips nested __proto__ properties', () => {
		// 1. The reviver sees every key at every depth, so a key hidden one level down is dropped as well
		const malicious = '{"outer": {"__proto__": {"polluted": true}}}';
		const result = parseJSON(malicious);
		expect(Object.prototype.hasOwnProperty.call(result.outer, '__proto__')).toBe(false);
	});

	it('handles JSON without __proto__ using fast path', () => {
		// 1. Harmless text with nesting takes the fast path and must parse the same as with the reviver
		const safe = '{"key": "value", "nested": {"inner": 1}}';
		expect(parseJSON(safe)).toEqual({ key: 'value', nested: { inner: 1 } });
	});

	it('handles __proto__ as part of another key name', () => {
		// 1. The substring switches the reviver on, but only the exact key `__proto__` is dropped, not one containing it
		const input = '{"my__proto__key": "value"}';
		const result = parseJSON(input);
		expect(result.my__proto__key).toBe('value');
	});
});

describe('parseJSON with escaped keys', () => {
	it('drops a __proto__ key spelled with unicode escapes as well', () => {
		// 1. `JSON.parse` resolves `_` to `_` before the reviver sees the key; a substring check on the raw text
		//    alone would take the fast path and leave an own `__proto__` property behind
		const parsed = parseJSON('{"\\u005f_proto__": {"admin": true}, "name": "x"}');

		expect(Object.hasOwn(parsed, '__proto__')).toBe(false);
		expect(parsed).toStrictEqual({ name: 'x' });
	});
});

describe('noproto', () => {
	it('returns value for non-__proto__ keys', () => {
		// 1. An ordinary key passes its value through, so the reviver changes nothing in a harmless document
		expect(noproto('key', 'value')).toBe('value');
	});

	it('returns undefined for __proto__ key', () => {
		// 1. `undefined` from a reviver deletes the key; that is how the prototype key is dropped
		expect(noproto('__proto__', 'value')).toBeUndefined();
	});

	it('returns value for keys containing __proto__ as substring', () => {
		// 1. Only the exact key is dangerous; a key merely containing the text is a legitimate property
		expect(noproto('my__proto__key', 'value')).toBe('value');
	});

	it('handles various value types', () => {
		// 1. The value is returned as it is, whatever its type: the reviver decides by key alone
		expect(noproto('key', 123)).toBe(123);
		expect(noproto('key', null)).toBe(null);
		expect(noproto('key', { nested: true })).toEqual({ nested: true });
		expect(noproto('key', [1, 2, 3])).toEqual([1, 2, 3]);
	});
});
