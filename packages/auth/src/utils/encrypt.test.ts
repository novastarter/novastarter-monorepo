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
	// Swap between two alphabet letters, so the decoded bytes change while the encoding stays well-formed
	const replacement = text[index] === 'A' ? 'B' : 'A';

	return text.slice(0, index) + replacement + text.slice(index + 1);
};

/**
 * A second secret, as an older key kept during rotation.
 */
const OLD_SECRET = 'an-older-application-secret-of-32+-characters';

describe('encrypt / decrypt', () => {
	test('Roundtrips a string, Unicode included, in the v2 format', () => {
		const payload = encrypt('JBSWY3DPEHPK3PXP — секрет', SECRET, 'totp-secret');

		expect(payload.split('.')).toHaveLength(4);
		expect(payload.startsWith('v2.')).toBe(true);

		expect(decrypt(payload, [SECRET], 'totp-secret')).toStrictEqual({
			plaintext: 'JBSWY3DPEHPK3PXP — секрет',
			keyIndex: 0,
		});
	});

	test('Uses a fresh IV per message, so equal plaintexts encrypt differently', () => {
		// A reused IV under GCM would leak the XOR of the plaintexts
		expect(encrypt('same', SECRET, 'totp-secret')).not.toBe(encrypt('same', SECRET, 'totp-secret'));
	});

	test('Roundtrips an empty string', () => {
		expect(decrypt(encrypt('', SECRET, 'oauth-cookie'), [SECRET], 'oauth-cookie').plaintext).toBe('');
	});

	test('Refuses a tampered ciphertext, tag or IV', () => {
		const [version, iv, tag, ciphertext] = encrypt('secret value', SECRET, 'totp-secret').split('.') as [
			string,
			string,
			string,
			string,
		];

		// Each part is covered by the tag: changing any one fails the authentication instead of returning garbage
		expect(() => decrypt([version, iv, tag, flip(ciphertext, 0)].join('.'), [SECRET], 'totp-secret')).toThrow();
		expect(() => decrypt([version, iv, flip(tag, 0), ciphertext].join('.'), [SECRET], 'totp-secret')).toThrow();
		expect(() => decrypt([version, flip(iv, 0), tag, ciphertext].join('.'), [SECRET], 'totp-secret')).toThrow();
	});

	test('Refuses a truncated tag, even one GCM would verify', () => {
		const [version, iv, tag, ciphertext] = encrypt('secret value', SECRET, 'oauth-cookie').split('.') as [
			string,
			string,
			string,
			string,
		];

		// The first 4 bytes of a real tag are a valid 32-bit GCM tag, so only the length check stops this payload
		const shortTag = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url');

		expect(() => decrypt([version, iv, shortTag, ciphertext].join('.'), [SECRET], 'oauth-cookie')).toThrow(
			'@novastarter/auth: the encrypted value is not in a known format',
		);
	});

	test('Refuses another key', () => {
		expect(() => decrypt(encrypt('secret value', SECRET, 'totp-secret'), [OLD_SECRET], 'totp-secret')).toThrow(
			'@novastarter/auth: the encrypted value does not open with any of the configured secrets',
		);
	});

	test('Refuses another purpose under the same secret', () => {
		// The purpose derives a key of its own: an OAuth cookie never opens as a TOTP secret
		expect(() => decrypt(encrypt('secret value', SECRET, 'oauth-cookie'), [SECRET], 'totp-secret')).toThrow(
			'@novastarter/auth: the encrypted value does not open with any of the configured secrets',
		);
	});

	test('Opens a value under an older secret and says which one opened it', () => {
		const payload = encrypt('secret value', OLD_SECRET, 'totp-secret');

		expect(decrypt(payload, [SECRET, OLD_SECRET], 'totp-secret')).toStrictEqual({
			plaintext: 'secret value',
			keyIndex: 1,
		});
	});

	test('Refuses a value not in the format before any cryptography', () => {
		const message = '@novastarter/auth: the encrypted value is not in a known format';

		expect(() => decrypt('v1.a.b.c', [SECRET], 'totp-secret')).toThrow(message);
		expect(() => decrypt('v2.a.b', [SECRET], 'totp-secret')).toThrow(message);
		expect(() => decrypt('v2..b.c', [SECRET], 'totp-secret')).toThrow(message);
		expect(() => decrypt('v2.a.b.c.d', [SECRET], 'totp-secret')).toThrow(message);
		expect(() => decrypt('JBSWY3DPEHPK3PXP', [SECRET], 'totp-secret')).toThrow(message);
	});
});
