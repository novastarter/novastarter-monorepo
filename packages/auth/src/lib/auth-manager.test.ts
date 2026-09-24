/**
 * Tests of `auth/lib/auth-manager`.
 */
import { LimiterDriverLocal } from '@novastarter/memory';
import { describe, expect, test } from 'vitest';
import { AuthManager } from './auth-manager.js';
import type { AuthSettings } from './settings.js';

describe('AuthManager settings', () => {
	test('Starts with empty settings', () => {
		// Nothing registered reads as an empty object, so every function falls back to its defaults
		expect(new AuthManager().settings()).toStrictEqual({});
	});

	test('Returns the registered settings by reference', () => {
		const manager = new AuthManager();
		const signIn = new LimiterDriverLocal({ points: 5, duration: 60 });
		const settings: AuthSettings = { session: { ttl: 1_000 }, limiters: { signIn } };

		manager.registerSettings(settings);

		// The very object, not a copy, so the limiters keep their identity and state
		expect(manager.settings()).toBe(settings);
		expect(manager.settings().limiters?.signIn).toBe(signIn);
	});

	test('Replaces the settings rather than merging them', () => {
		const manager = new AuthManager();

		manager.registerSettings({ session: { ttl: 1_000 }, oauth: { stateTtl: 60_000 } });
		manager.registerSettings({ tokens: { ttl: 2_000 } });

		// A second bootstrap gets exactly what it registered; nothing of the first survives
		expect(manager.settings()).toStrictEqual({ tokens: { ttl: 2_000 } });
	});
});
