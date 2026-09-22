/**
 * Tests of `auth/passwords/verify-password`.
 */
import { describe, expect, test } from 'vitest';
import { hashPassword } from './hash-password.js';
import { MAX_PASSWORD_LENGTH, type ScryptParams } from './scrypt-params.js';
import { verifyPassword } from './verify-password.js';

/**
 * A cheap cost, so a hash takes microseconds instead of a tenth of a second.
 */
const FAST: ScryptParams = { ln: 4, r: 8, p: 1 };

describe('verifyPassword', () => {
	test('Accepts the right password and refuses a wrong one', async () => {
		const hash = await hashPassword('hunter2hunter2', FAST);

		// 1. A roundtrip, then one character off and a case change
		expect(await verifyPassword('hunter2hunter2', hash)).toBe(true);
		expect(await verifyPassword('hunter2hunter3', hash)).toBe(false);
		expect(await verifyPassword('HUNTER2HUNTER2', hash)).toBe(false);
	});

	test('Treats the composed and the decomposed form of a character as the same password', async () => {
		// 1. Hashed as typed on one keyboard, verified as typed on another
		const hash = await hashPassword('café-päss', FAST);

		expect(await verifyPassword('café-päss', hash)).toBe(true);
	});

	test('Verifies a hash made with another cost than the default', async () => {
		// 1. The cost travels in the hash, so raising the default does not break old hashes
		const hash = await hashPassword('old account', { ln: 5, r: 4, p: 2 });

		expect(await verifyPassword('old account', hash)).toBe(true);
	});

	test('Refuses an empty or an overlong password as a payload error', async () => {
		const hash = await hashPassword('something', FAST);

		// 1. The same bounds as hashing, checked before the work
		await expect(verifyPassword('', hash)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });

		await expect(verifyPassword('x'.repeat(MAX_PASSWORD_LENGTH + 1), hash)).rejects.toMatchObject({
			code: 'INVALID_PAYLOAD',
		});
	});

	test('Throws on a broken hash rather than answering false', async () => {
		// 1. A corrupt record is an error to look into, not a wrong password to show the user
		await expect(verifyPassword('anything', 'not-a-hash')).rejects.toThrow(
			'The password hash is not a scrypt hash in the PHC format',
		);

		await expect(verifyPassword('anything', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA')).rejects.toThrow(
			'The password hash is not a scrypt hash in the PHC format',
		);
	});

	test('Throws on a hash whose cost is out of bounds before running scrypt', async () => {
		// 1. A tampered `ln` could otherwise make one verification allocate gigabytes
		await expect(verifyPassword('anything', '$scrypt$ln=30,r=8,p=1$c2FsdHNhbHQ$a2V5a2V5')).rejects.toThrow(
			'The password hash has a scrypt cost out of bounds',
		);
	});
});
