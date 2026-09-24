/**
 * Tests of `auth/mfa/mfa-key`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { useAuth } from '../lib/use-auth.js';
import { mfaKeys } from './mfa-key.js';

/**
 * An encryption key long enough to be accepted.
 */
const KEY = 'test-mfa-encryption-key-of-32-characters';

/**
 * The error every unusable key is refused with.
 */
const MESSAGE = 'The "mfa.encryptionKey" auth setting must be at least 32 characters of random data';

afterEach(() => {
	useAuth.reset();
});

describe('mfaKeys', () => {
	test('Returns the encryption key of the settings as a list', () => {
		useAuth().registerSettings({ mfa: { encryptionKey: KEY } });

		expect(mfaKeys()).toStrictEqual([KEY]);

		useAuth().registerSettings({ mfa: { encryptionKey: [KEY, 'o'.repeat(32)] } });
		expect(mfaKeys()).toStrictEqual([KEY, 'o'.repeat(32)]);
	});

	test('Refuses to run without one, an empty one included', () => {
		expect(() => mfaKeys()).toThrow(MESSAGE);

		useAuth().registerSettings({ mfa: { issuer: 'Acme' } });
		expect(() => mfaKeys()).toThrow(MESSAGE);

		useAuth().registerSettings({ mfa: { encryptionKey: '' } });
		expect(() => mfaKeys()).toThrow(MESSAGE);

		useAuth().registerSettings({ mfa: { encryptionKey: [] } });
		expect(() => mfaKeys()).toThrow(MESSAGE);
	});

	test('Refuses a key shorter than 32 characters', () => {
		// Thirty-one characters is not random data, and would let a database dump be decrypted offline
		useAuth().registerSettings({ mfa: { encryptionKey: 'k'.repeat(31) } });
		expect(() => mfaKeys()).toThrow(MESSAGE);

		// An old key kept for rotation is held to the same bar
		useAuth().registerSettings({ mfa: { encryptionKey: [KEY, 'k'.repeat(31)] } });
		expect(() => mfaKeys()).toThrow(MESSAGE);

		useAuth().registerSettings({ mfa: { encryptionKey: 'k'.repeat(32) } });
		expect(mfaKeys()).toStrictEqual(['k'.repeat(32)]);
	});
});
