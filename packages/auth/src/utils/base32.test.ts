/**
 * Tests of `auth/utils/base32`.
 */
import { describe, expect, test } from 'vitest';
import { decodeBase32, encodeBase32 } from './base32.js';

/**
 * RFC 4648 section 10 vectors, with the `=` padding stripped, since the encoder never writes it.
 */
const VECTORS: [string, string][] = [
	['', ''],
	['f', 'MY'],
	['fo', 'MZXQ'],
	['foo', 'MZXW6'],
	['foob', 'MZXW6YQ'],
	['fooba', 'MZXW6YTB'],
	['foobar', 'MZXW6YTBOI'],
];

describe('encodeBase32', () => {
	test.each(VECTORS)('Encodes %j as the RFC 4648 vector %j without padding', (input, expected) => {
		// 1. The published vectors pin the alphabet, the bit order and the handling of the last partial character
		expect(encodeBase32(Buffer.from(input, 'utf8'))).toBe(expected);
	});
});

describe('decodeBase32', () => {
	test.each(VECTORS)('Decodes back to %j from %j', (expected, input) => {
		// 1. The trailing zero bits of the last character are padding, not an extra byte
		expect(Buffer.from(decodeBase32(input)).toString('utf8')).toBe(expected);
	});

	test('Forgives case, spaces, dashes and padding the way a hand-typed secret comes in', () => {
		// 1. The same value grouped, lower-cased and padded decodes to the same bytes
		expect(Buffer.from(decodeBase32('mzxw 6ytb-oi======')).toString('utf8')).toBe('foobar');
	});

	test('Refuses a character outside the alphabet', () => {
		// 1. `1`, `8`, `0` and `9` are not base32; a silent skip would decode a different secret
		expect(() => decodeBase32('MZXW1')).toThrow('Invalid base32 character "1"');
	});

	test('Roundtrips random bytes of every length', () => {
		// 1. Every remainder of the 5-byte block is covered, so no length loses or gains a byte
		for (let length = 0; length <= 25; length++) {
			const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + length) & 255);

			expect(decodeBase32(encodeBase32(bytes))).toStrictEqual(bytes);
		}
	});
});
