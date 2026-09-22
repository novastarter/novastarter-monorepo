/**
 * Tests of `utils/to-boolean`.
 */
import { describe, expect, it } from 'vitest';
import { toBoolean } from './to-boolean.js';

describe('toBoolean', () => {
	it('returns true for string "true"', () => {
		// 1. The spelling an env file carries: `FLAG=true`
		expect(toBoolean('true')).toBe(true);
	});

	it('returns true for boolean true', () => {
		// 1. A real boolean from a config object passes through unchanged
		expect(toBoolean(true)).toBe(true);
	});

	it('returns true for string "1"', () => {
		// 1. `FLAG=1` is the other accepted spelling in an env file
		expect(toBoolean('1')).toBe(true);
	});

	it('returns true for number 1', () => {
		// 1. A numeric `1` from a parsed config counts the same as its string form
		expect(toBoolean(1)).toBe(true);
	});

	it('returns false for string "false"', () => {
		// 1. A non-empty string is truthy in JavaScript; the explicit comparison is what keeps `'false'` false
		expect(toBoolean('false')).toBe(false);
	});

	it('returns false for boolean false', () => {
		// 1. A real `false` stays `false`
		expect(toBoolean(false)).toBe(false);
	});

	it('returns false for string "0"', () => {
		// 1. `'0'` is truthy as a string; it must read as the number it spells
		expect(toBoolean('0')).toBe(false);
	});

	it('returns false for number 0', () => {
		// 1. Zero is the numeric spelling of `false`
		expect(toBoolean(0)).toBe(false);
	});

	it('returns false for null', () => {
		// 1. An unset value enables nothing
		expect(toBoolean(null)).toBe(false);
	});

	it('returns false for undefined', () => {
		// 1. A missing env variable arrives as `undefined` and must not enable a feature
		expect(toBoolean(undefined)).toBe(false);
	});

	it('returns false for empty string', () => {
		// 1. `FLAG=` with nothing after it is unset, not on
		expect(toBoolean('')).toBe(false);
	});

	it('returns false for random string', () => {
		// 1. `'yes'` is the misspelt-flag case the strict comparison exists for
		expect(toBoolean('yes')).toBe(false);
	});

	it('returns false for object', () => {
		// 1. An object is truthy in JavaScript but is no flag spelling, so it stays off
		expect(toBoolean({})).toBe(false);
	});

	it('returns false for array', () => {
		// 1. Same for an array, however truthy
		expect(toBoolean([])).toBe(false);
	});
});
