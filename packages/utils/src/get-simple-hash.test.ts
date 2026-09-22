/**
 * Tests of `utils/get-simple-hash`.
 */
import { expect, test } from 'vitest';
import { getSimpleHash } from './get-simple-hash.js';

test('Returns the same digest for the same input', () => {
	// 1. A cache key built from the digest must be stable across calls, and it is unsigned 32-bit hex: at most eight
	//    lower-case digits, no sign
	expect(getSimpleHash('hello')).toBe(getSimpleHash('hello'));
	expect(getSimpleHash('hello')).toMatch(/^[0-9a-f]{1,8}$/);
});

test('Returns a different digest for a different input', () => {
	// 1. One extra character must change the digest, or two keys would collide on the smallest edit
	expect(getSimpleHash('hello')).not.toBe(getSimpleHash('hello!'));
});

test('Hashes the empty string to zero', () => {
	// 1. No code unit is folded in, so the running value stays at its seed of zero
	expect(getSimpleHash('')).toBe('0');
});

test('Never carries a sign', () => {
	// 1. A long input drives the running value negative before it is reinterpreted as unsigned
	expect(getSimpleHash('x'.repeat(100))).not.toMatch(/^-/);
});
