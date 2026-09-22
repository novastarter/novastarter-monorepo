/**
 * Tests of `auth/utils/random-token`.
 */
import { describe, expect, test } from 'vitest';
import { DEFAULT_TOKEN_BYTES, randomDigits, randomToken } from './random-token.js';

describe('randomToken', () => {
	test('Makes 43 base64url characters from the default 32 bytes', () => {
		// 1. No padding and no characters that need escaping in a URL, a cookie or a header
		expect(DEFAULT_TOKEN_BYTES).toBe(32);
		expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	test('Honours the byte count and never repeats itself', () => {
		// 1. 16 bytes encode to 22 characters
		expect(randomToken(16)).toHaveLength(22);

		// 2. A hundred draws of 256 bits cannot collide unless the source is broken
		expect(new Set(Array.from({ length: 100 }, () => randomToken())).size).toBe(100);
	});
});

describe('randomDigits', () => {
	test('Makes a code of exactly the requested number of decimal digits', () => {
		// 1. Leading zeros are kept, so the length is fixed
		for (let index = 0; index < 50; index++) {
			expect(randomDigits(6)).toMatch(/^\d{6}$/);
		}

		expect(randomDigits(0)).toBe('');
	});

	test('Uses every digit', () => {
		// 1. Enough draws that a missing digit would mean a biased source, not bad luck
		const seen = new Set(randomDigits(1000).split(''));

		expect(seen.size).toBe(10);
	});
});
