/**
 * Tests of `auth/lib/settings-access`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { authSettings } from './settings-access.js';
import type { AuthSettings } from './settings.js';
import { useAuth } from './use-auth.js';

afterEach(() => {
	useAuth.reset();
});

describe('authSettings', () => {
	test('Reads the settings of useAuth() afresh on every call', () => {
		expect(authSettings()).toStrictEqual({});

		const settings: AuthSettings = { session: { ttl: 1_000 } };

		useAuth().registerSettings(settings);
		expect(authSettings()).toBe(settings);
	});
});
