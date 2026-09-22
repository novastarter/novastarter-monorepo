/**
 * Tests of `auth/mfa/enroll-totp`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { useAuth } from '../lib/use-auth.js';
import { decodeBase32, decrypt } from '../utils/index.js';
import { enrollTotp, TOTP_SECRET_BYTES } from './enroll-totp.js';

/**
 * An encryption key long enough to be accepted.
 */
const KEY = 'test-mfa-encryption-key-of-32-characters';

afterEach(() => {
	useAuth.reset();
});

describe('enrollTotp', () => {
	test('Makes a 160-bit base32 secret, its URI and its encrypted form', () => {
		useAuth().registerSettings({ mfa: { issuer: 'Acme', encryptionKey: KEY } });

		const { secret, uri, encryptedSecret } = enrollTotp({ accountName: 'user@example.com' });

		// 1. Twenty bytes, upper-case base32 without padding
		expect(secret).toMatch(/^[A-Z2-7]{32}$/);
		expect(decodeBase32(secret)).toHaveLength(TOTP_SECRET_BYTES);

		// 2. The URI names the issuer and the account and carries the secret
		const parsed = new URL(uri);

		expect(uri.startsWith(`otpauth://totp/${encodeURIComponent('Acme:user@example.com')}?`)).toBe(true);
		expect(parsed.searchParams.get('secret')).toBe(secret);
		expect(parsed.searchParams.get('issuer')).toBe('Acme');

		// 3. The stored form is not the secret, and opens back to it with the key
		expect(encryptedSecret).not.toContain(secret);
		expect(decrypt(encryptedSecret, KEY)).toBe(secret);
	});

	test('Names the issuer Novastarter when the settings do not', () => {
		useAuth().registerSettings({ mfa: { encryptionKey: KEY } });

		// 1. Authenticator apps need some name above the code
		expect(new URL(enrollTotp({ accountName: 'a' }).uri).searchParams.get('issuer')).toBe('Novastarter');
	});

	test('Makes a new secret on every call', () => {
		useAuth().registerSettings({ mfa: { encryptionKey: KEY } });

		// 1. Two enrolments never share a secret
		expect(enrollTotp({ accountName: 'a' }).secret).not.toBe(enrollTotp({ accountName: 'a' }).secret);
	});

	test('Refuses to run without a usable encryption key', () => {
		// 1. A short key would leave the stored secrets open to a database dump
		useAuth().registerSettings({ mfa: { encryptionKey: 'short' } });

		expect(() => enrollTotp({ accountName: 'a' })).toThrow(
			'The "mfa.encryptionKey" auth setting must be at least 32 characters of random data',
		);
	});
});
