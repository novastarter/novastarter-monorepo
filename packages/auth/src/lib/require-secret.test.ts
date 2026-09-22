/**
 * Tests of `auth/lib/require-secret`.
 */
import { describe, expect, test } from 'vitest';
import { requireSecret } from './require-secret.js';
import { MIN_SECRET_LENGTH } from './settings.js';

describe('requireSecret', () => {
	test('Returns a secret of at least the minimum length as given', () => {
		// 1. Exactly the minimum passes, and a longer one too
		expect(MIN_SECRET_LENGTH).toBe(32);
		expect(requireSecret('s'.repeat(32), 'jwt.secret')).toBe('s'.repeat(32));
		expect(requireSecret('s'.repeat(64), 'jwt.secret')).toBe('s'.repeat(64));
	});

	test('Refuses a missing, empty or short secret, naming the setting', () => {
		const message = 'The "oauth.secret" auth setting must be at least 32 characters of random data';

		// 1. There is no safe default for a secret, and one under the minimum is not random data
		expect(() => requireSecret(undefined, 'oauth.secret')).toThrow(message);
		expect(() => requireSecret('', 'oauth.secret')).toThrow(message);
		expect(() => requireSecret('s'.repeat(31), 'oauth.secret')).toThrow(message);
	});
});
