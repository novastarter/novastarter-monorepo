/**
 * Tests of `auth/mfa/reencrypt-totp-secret`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { useAuth } from '../lib/use-auth.js';
import { decrypt } from '../utils/index.js';
import { enrollTotp } from './enroll-totp.js';
import { reencryptTotpSecret } from './reencrypt-totp-secret.js';

/**
 * The key a rotation moves away from.
 */
const OLD_KEY = 'old-mfa-encryption-key-of-32-characters!';

/**
 * The key a rotation moves to.
 */
const NEW_KEY = 'new-mfa-encryption-key-of-32-characters!';

afterEach(() => {
	useAuth.reset();
});

describe('reencryptTotpSecret', () => {
	test('Moves a secret from the old key to the new one, and leaves a current one alone', () => {
		useAuth().registerSettings({ mfa: { encryptionKey: OLD_KEY } });

		const { secret, encryptedSecret } = enrollTotp({ accountName: 'a' });

		useAuth().registerSettings({ mfa: { encryptionKey: [NEW_KEY, OLD_KEY] } });

		const moved = reencryptTotpSecret(encryptedSecret);

		expect(moved).not.toBeNull();
		expect(decrypt(moved!, [NEW_KEY], 'totp-secret').plaintext).toBe(secret);

		expect(reencryptTotpSecret(moved!)).toBeNull();
	});

	test('Refuses a secret none of the keys opens', () => {
		useAuth().registerSettings({ mfa: { encryptionKey: OLD_KEY } });

		const { encryptedSecret } = enrollTotp({ accountName: 'a' });

		useAuth().registerSettings({ mfa: { encryptionKey: NEW_KEY } });

		expect(() => reencryptTotpSecret(encryptedSecret)).toThrow(
			'@novastarter/auth: the encrypted value does not open with any of the configured secrets',
		);
	});
});
