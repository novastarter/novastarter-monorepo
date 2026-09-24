/**
 * Tests of `utils/tryParseJSON`: valid JSON parses, invalid JSON yields the fallback, other errors surface.
 */
import { expect, test, vi } from 'vitest';
import { parseJSON } from './parse-json.js';
import { tryParseJSON } from './try-parse-json.js';

vi.mock('./parse-json.js', { spy: true });

test('Parses valid JSON', () => {
	// Every JSON value kind parses as it would with `parseJSON`; the fallback plays no part
	expect(tryParseJSON('{"a":1}')).toEqual({ a: 1 });
	expect(tryParseJSON('[1,2]')).toEqual([1, 2]);
	expect(tryParseJSON('null')).toBeNull();
	expect(tryParseJSON('"text"')).toBe('text');
});

test('Answers with the fallback when the text is not JSON', () => {
	// A plain word is the common case: it comes back as whatever the caller wants to keep
	expect(tryParseJSON('production', 'production')).toBe('production');
	expect(tryParseJSON('{broken', null)).toBeNull();
});

test('Answers undefined without a fallback', () => {
	// No fallback means `undefined`, for text that is not JSON and for empty text alike
	expect(tryParseJSON('nope')).toBeUndefined();
	expect(tryParseJSON('')).toBeUndefined();
});

test('Goes through the prototype-safe parser', () => {
	// `__proto__` keys are dropped, the same as `parseJSON` does, since the text may be untrusted
	expect(tryParseJSON('{"__proto__":{"admin":true},"name":"x"}')).toEqual({ name: 'x' });
	expect(parseJSON).toHaveBeenCalled();
});

test('Rethrows errors other than a syntax error', () => {
	// Only "not JSON" is expected; anything else is a fault the caller must see
	vi.mocked(parseJSON).mockImplementationOnce(() => {
		throw new RangeError('too deep');
	});

	expect(() => tryParseJSON('{}', 'fallback')).toThrow(RangeError);
});

test('Types the answer from an explicit type argument, with and without a fallback', () => {
	// With one explicit type argument the fallback's type defaults to it — no second argument needed — and without
	// a fallback the answer admits `undefined`; both lines fail `tsc` if the overloads regress
	interface Config {
		a: number;
	}

	const fallback: Config = { a: 1 };
	const withFallback: Config = tryParseJSON<Config>('nope', fallback);
	const withoutFallback: Config | undefined = tryParseJSON<Config>('nope');

	expect(withFallback).toBe(fallback);
	expect(withoutFallback).toBeUndefined();
});
