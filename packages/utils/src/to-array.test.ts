/**
 * Tests of `utils/to-array`.
 */
import { describe, expect, it } from 'vitest';
import { toArray } from './to-array.js';

describe('toArray', () => {
	it('returns the same array if already an array', () => {
		// The documented contract is the same instance, not a copy, so a caller may keep mutating it
		const input = [1, 2, 3];
		expect(toArray(input)).toBe(input);
	});

	it('wraps a single value in an array', () => {
		// A lone value becomes a one-element list, so the caller can always iterate
		expect(toArray(1)).toEqual([1]);
	});

	it('wraps null in an array', () => {
		// `null` is a value like any other here, not an empty list
		expect(toArray(null)).toEqual([null]);
	});

	it('wraps undefined in an array', () => {
		// Same for `undefined`: the helper does not decide what a missing value means
		expect(toArray(undefined)).toEqual([undefined]);
	});

	it('wraps an object in an array', () => {
		// An object is a single item; only strings and arrays are treated as lists
		const obj = { key: 'value' };
		expect(toArray(obj)).toEqual([obj]);
	});

	it('splits a comma-separated string into array', () => {
		// `LIST=a,b,c` in an env file is the reason strings are split at all
		expect(toArray('a,b,c')).toEqual(['a', 'b', 'c']);
	});

	it('splits a string with spaces around commas', () => {
		// The split is on the comma alone; trimming is left to the caller, which knows whether blanks matter
		expect(toArray('a, b, c')).toEqual(['a', ' b', ' c']);
	});

	it('returns single-element array for string without commas', () => {
		// A string without a comma is a one-item list, the same as a wrapped value
		expect(toArray('hello')).toEqual(['hello']);
	});

	it('handles empty string', () => {
		// `split` on an empty string gives one empty item; the helper does not turn it into an empty list
		expect(toArray('')).toEqual(['']);
	});

	it('handles empty array', () => {
		// An empty list stays an empty list rather than being wrapped into `[[]]`
		expect(toArray([])).toEqual([]);
	});

	it('preserves array with mixed types', () => {
		// The element types play no part; the instance is handed back as it is
		const input = [1, 'two', { three: 3 }];
		expect(toArray(input)).toBe(input);
	});

	it('wraps boolean in an array', () => {
		// `false` is wrapped like any value; falsiness must not turn it into an empty list
		expect(toArray(true)).toEqual([true]);
		expect(toArray(false)).toEqual([false]);
	});

	it('wraps number 0 in an array', () => {
		// Same for zero, the other falsy value a config may carry
		expect(toArray(0)).toEqual([0]);
	});
});
