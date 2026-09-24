/**
 * Tests of `auth/utils/hash-token`.
 */
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { hashToken, safeEqual } from './hash-token.js';

describe('hashToken', () => {
	test('Is the base64url SHA-256 of the token, stable across calls', () => {
		// The store looks tokens up by this value, so it must be deterministic and match plain SHA-256
		const expected = createHash('sha256').update('token-value').digest('base64url');

		expect(hashToken('token-value')).toBe(expected);
		expect(hashToken('token-value')).toBe(hashToken('token-value'));

		expect(hashToken('token-value')).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	test('Differs for different tokens', () => {
		expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
	});
});

describe('safeEqual', () => {
	test('Is true for equal strings and false otherwise, whatever the lengths', () => {
		// Equal strings, a differing character, and different lengths, which `timingSafeEqual` alone would throw on
		expect(safeEqual('abc', 'abc')).toBe(true);
		expect(safeEqual('abc', 'abd')).toBe(false);
		expect(safeEqual('abc', 'abcd')).toBe(false);
		expect(safeEqual('', '')).toBe(true);
	});
});
