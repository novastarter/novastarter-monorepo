/**
 * Tests of `auth/utils/encrypt`.
 */
import { describe, expect, test } from 'vitest';
import { decrypt, encrypt } from './encrypt.js';

/**
 * The secret every test encrypts with.
 */
const SECRET = 'a-long-random-application-secret-of-32+-chars';

/**
 * Flip one character of a base64url string, keeping it valid base64url.
 *
 * @param text - The string to change.
 * @param index - Position of the character to flip.
 * @returns The string with that character replaced.
 */
const flip = (text: string, index: number): string => {
	// 1. Swap between two alphabet letters, so the decoded bytes change while the encoding stays well-formed
	const replacement = text[index] === 'A' ? 'B' : 'A';

	return text.slice(0, index) + replacement + text.slice(index + 1);
};

describe('encrypt / decrypt', () => {
	test('Roundtrips a string, Unicode included, in the v1 format', () => {
		const payload = encrypt('JBSWY3DPEHPK3PXP — секрет', SECRET);

		// 1. Four dot-separated parts, the first naming the format
		expect(payload.split('.')).toHaveLength(4);
		expect(payload.startsWith('v1.')).toBe(true);

		// 2. The plaintext comes back byte for byte
		expect(decrypt(payload, SECRET)).toBe('JBSWY3DPEHPK3PXP — секрет');
	});

	test('Uses a fresh IV per message, so equal plaintexts encrypt differently', () => {
		// 1. A reused IV under GCM would leak the XOR of the plaintexts
		expect(encrypt('same', SECRET)).not.toBe(encrypt('same', SECRET));
	});

	test('Roundtrips an empty string', () => {
		// 1. An empty ciphertext part is still a valid payload
		expect(decrypt(encrypt('', SECRET), SECRET)).toBe('');
	});

	test('Refuses a tampered ciphertext, tag or IV', () => {
		const [version, iv, tag, ciphertext] = encrypt('secret value', SECRET).split('.') as [
			string,
			string,
			string,
			string,
		];

		// 1. Each part is covered by the tag: changing any one fails the authentication instead of returning garbage
		expect(() => decrypt([version, iv, tag, flip(ciphertext, 0)].join('.'), SECRET)).toThrow();
		expect(() => decrypt([version, iv, flip(tag, 0), ciphertext].join('.'), SECRET)).toThrow();
		expect(() => decrypt([version, flip(iv, 0), tag, ciphertext].join('.'), SECRET)).toThrow();
	});

	test('Refuses another key', () => {
		// 1. The tag does not verify under another key
		expect(() => decrypt(encrypt('secret value', SECRET), 'another-secret')).toThrow();
	});

	test('Refuses a value not in the format before any cryptography', () => {
		// 1. Wrong version, missing parts and plain text all fail with the same readable message
		expect(() => decrypt('v2.a.b.c', SECRET)).toThrow('The encrypted value is not in a known format');
		expect(() => decrypt('v1.a.b', SECRET)).toThrow('The encrypted value is not in a known format');
		expect(() => decrypt('v1..b.c', SECRET)).toThrow('The encrypted value is not in a known format');
		expect(() => decrypt('JBSWY3DPEHPK3PXP', SECRET)).toThrow('The encrypted value is not in a known format');
	});
});
