/**
 * Tests of `utils/toNumber`: strings and numbers convert, everything else is `undefined`.
 */
import { expect, test } from 'vitest';
import { toNumber } from './to-number.js';

test('Parses numeric strings, trimming whitespace', () => {
	// Integers, decimals, negatives, exponents and hex are what `Number()` accepts; surrounding blanks are ignored
	expect(toNumber('8055')).toBe(8055);
	expect(toNumber(' 1.5 ')).toBe(1.5);
	expect(toNumber('-3')).toBe(-3);
	expect(toNumber('1e3')).toBe(1000);
	expect(toNumber('0x10')).toBe(16);
	expect(toNumber('0')).toBe(0);
});

test('Passes finite numbers through', () => {
	// A number is already what the caller wants; zero and negatives must not be mistaken for missing
	expect(toNumber(42)).toBe(42);
	expect(toNumber(0)).toBe(0);
	expect(toNumber(-0.5)).toBe(-0.5);
});

test('Answers undefined for strings that are not a number', () => {
	// Empty, blank, words and trailing units all stay out; none of them become `NaN` or `0`
	expect(toNumber('')).toBeUndefined();
	expect(toNumber('   ')).toBeUndefined();
	expect(toNumber('abc')).toBeUndefined();
	expect(toNumber('12px')).toBeUndefined();
	expect(toNumber('Infinity')).toBeUndefined();
	expect(toNumber('NaN')).toBeUndefined();
});

test('Answers undefined for non-finite numbers', () => {
	// `NaN` and the infinities are numbers to `typeof`, but no config value; they are refused like bad text
	expect(toNumber(Number.NaN)).toBeUndefined();
	expect(toNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
	expect(toNumber(Number.NEGATIVE_INFINITY)).toBeUndefined();
});

test('Answers undefined for every other type', () => {
	// `Number(true)`, `Number(null)` and `Number([])` would give `1`, `0` and `0`; none of those is a config value
	expect(toNumber(true)).toBeUndefined();
	expect(toNumber(false)).toBeUndefined();
	expect(toNumber(null)).toBeUndefined();
	expect(toNumber(undefined)).toBeUndefined();
	expect(toNumber([])).toBeUndefined();
	expect(toNumber({})).toBeUndefined();
	expect(toNumber(10n)).toBeUndefined();
});
