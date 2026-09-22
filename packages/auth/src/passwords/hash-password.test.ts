/**
 * Tests of `auth/passwords/hash-password`.
 *
 * The hashes are made at a low cost for speed; one test runs the default cost to prove it fits Node's memory limit.
 */
import { describe, expect, test } from 'vitest';
import { hashPassword, normalizePassword } from './hash-password.js';
import { MAX_PASSWORD_LENGTH, parseHash, type ScryptParams } from './scrypt-params.js';
import { verifyPassword } from './verify-password.js';

/**
 * A cheap cost, so a hash takes microseconds instead of a tenth of a second.
 */
const FAST: ScryptParams = { ln: 4, r: 8, p: 1 };

describe('hashPassword', () => {
	test('Writes a PHC scrypt string carrying the cost, a 16-byte salt and a 32-byte key', async () => {
		const hash = await hashPassword('correct horse battery staple', FAST);

		// 1. The exact shape `parseHash` reads back, base64 without padding
		expect(hash).toMatch(/^\$scrypt\$ln=4,r=8,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);

		// 2. The parts decode to the sizes the module promises
		const parsed = parseHash(hash);

		expect(parsed.params).toStrictEqual(FAST);
		expect(parsed.salt).toHaveLength(16);
		expect(parsed.key).toHaveLength(32);
	});

	test('Salts every hash, so equal passwords hash differently and both verify', async () => {
		const first = await hashPassword('same password', FAST);
		const second = await hashPassword('same password', FAST);

		// 1. Different strings, the same password behind each
		expect(first).not.toBe(second);
		expect(await verifyPassword('same password', first)).toBe(true);
		expect(await verifyPassword('same password', second)).toBe(true);
	});

	test('Uses the default cost when none is given', async () => {
		// 1. The default cost runs within the `maxmem` the module computes; otherwise Node would refuse it
		const hash = await hashPassword('default cost');

		expect(hash.startsWith('$scrypt$ln=17,r=8,p=1$')).toBe(true);
		expect(await verifyPassword('default cost', hash)).toBe(true);
	});

	test('Refuses an empty password and one longer than the maximum', async () => {
		// 1. Both are rejected before any hashing, as a payload error the caller can show
		await expect(hashPassword('', FAST)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });

		await expect(hashPassword('x'.repeat(MAX_PASSWORD_LENGTH + 1), FAST)).rejects.toMatchObject({
			code: 'INVALID_PAYLOAD',
		});

		// 2. The maximum itself is still accepted
		await expect(hashPassword('x'.repeat(MAX_PASSWORD_LENGTH), FAST)).resolves.toMatch(/^\$scrypt\$/);
	});
});

describe('normalizePassword', () => {
	test('Folds a decomposed character into its composed form', () => {
		// 1. "é" typed as `e` + combining acute and as one code point is the same password
		expect(normalizePassword('café')).toBe('café');
	});

	test('Refuses a value that is not a string', () => {
		// 1. A form field parsed as a number or `null` must not reach scrypt
		expect(() => normalizePassword(123 as unknown as string)).toThrow(/1 to 1024 characters/);
		expect(() => normalizePassword(null as unknown as string)).toThrow(/1 to 1024 characters/);
	});
});
