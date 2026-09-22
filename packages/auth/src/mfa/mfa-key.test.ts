/**
 * Tests of `auth/mfa/mfa-key`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { useAuth } from '../lib/use-auth.js';
import { mfaKey } from './mfa-key.js';

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

describe('mfaKey', () => {
	test('Returns the encryption key of the settings', () => {
		useAuth().registerSettings({ mfa: { encryptionKey: KEY } });

		// 1. Read as registered
		expect(mfaKey()).toBe(KEY);
	});

	test('Refuses to run without one, an empty one included', () => {
		// 1. No settings, no mfa section, and an empty key are all a missing key
		expect(() => mfaKey()).toThrow(MESSAGE);

		useAuth().registerSettings({ mfa: { issuer: 'Acme' } });
		expect(() => mfaKey()).toThrow(MESSAGE);

		useAuth().registerSettings({ mfa: { encryptionKey: '' } });
		expect(() => mfaKey()).toThrow(MESSAGE);
	});

	test('Refuses a key shorter than 32 characters', () => {
		// 1. Thirty-one characters is not random data, and would let a database dump be decrypted offline
		useAuth().registerSettings({ mfa: { encryptionKey: 'k'.repeat(31) } });
		expect(() => mfaKey()).toThrow(MESSAGE);

		// 2. Thirty-two is the bar
		useAuth().registerSettings({ mfa: { encryptionKey: 'k'.repeat(32) } });
		expect(mfaKey()).toBe('k'.repeat(32));
	});
});
