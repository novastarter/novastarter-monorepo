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
		// 1. Nothing registered is an empty object
		expect(authSettings()).toStrictEqual({});

		// 2. A registration made after the first read is seen by the next one
		const settings: AuthSettings = { session: { ttl: 1_000 } };

		useAuth().registerSettings(settings);
		expect(authSettings()).toBe(settings);
	});
});
