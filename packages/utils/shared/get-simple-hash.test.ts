import { expect, test } from 'vitest';
import { getSimpleHash } from './get-simple-hash.js';

test('Returns the same digest for the same input', () => {
	expect(getSimpleHash('hello')).toBe(getSimpleHash('hello'));
	expect(getSimpleHash('hello')).toMatch(/^[0-9a-f]{1,8}$/);
});

test('Returns a different digest for a different input', () => {
	expect(getSimpleHash('hello')).not.toBe(getSimpleHash('hello!'));
});

test('Hashes the empty string to zero', () => {
	expect(getSimpleHash('')).toBe('0');
});

test('Never carries a sign', () => {
	// A long input drives the running value negative before it is reinterpreted as unsigned
	expect(getSimpleHash('x'.repeat(100))).not.toMatch(/^-/);
});
