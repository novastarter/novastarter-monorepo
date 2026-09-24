/**
 * Tests of `feature-flags/lib/use-feature-flags`: registration, the process-wide flags, and their absence.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { FeatureFlagsDriver } from '../driver.js';
import { FeatureFlags } from './feature-flags.js';
import { registerFeatureFlags, useFeatureFlags } from './use-feature-flags.js';

afterEach(() => {
	useFeatureFlags.reset();
});

describe('useFeatureFlags', () => {
	test('Throws before any registration', () => {
		// A forgotten registration fails loudly instead of switching every feature off
		expect(() => useFeatureFlags()).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. Feature flags are not registered; call registerFeatureFlags() at start-up.]`,
		);
	});
});

describe('registerFeatureFlags', () => {
	test('Serves plain flags through the static driver, the same object on every call', async () => {
		registerFeatureFlags({
			flags: [
				{ key: 'beta-ai', enabled: true },
				{ key: 'new-billing', enabled: true, rules: { users: ['u1'] } },
			],
		});

		expect(useFeatureFlags()).toBeInstanceOf(FeatureFlags);
		expect(useFeatureFlags()).toBe(useFeatureFlags());
		await expect(useFeatureFlags().get('beta-ai')).resolves.toBe(true);
		await expect(useFeatureFlags().get('new-billing', { user: 'u2' })).resolves.toBe(false);

		await expect(useFeatureFlags().getAll({ user: 'u1' })).resolves.toStrictEqual({
			'beta-ai': true,
			'new-billing': true,
		});
	});

	test('Fails at registration on an invalid flag', () => {
		// The static driver is built by the registration, so a bad key fails the boot rather than a request
		expect(() => registerFeatureFlags({ flags: [{ key: 'Bad Key', enabled: true }] })).toThrow();
		expect(() => useFeatureFlags()).toThrow();
	});

	test('Serves a driver of the application and closes it on shutdown', async () => {
		const driver: FeatureFlagsDriver = {
			get: vi.fn(async () => true),
			getAll: vi.fn(async () => ({ vendor: true })),
			list: vi.fn(async () => [{ key: 'vendor', enabled: true }]),
			close: vi.fn(async () => undefined),
		};

		registerFeatureFlags({ driver });

		await expect(useFeatureFlags().get('vendor')).resolves.toBe(true);
		expect(driver.get).toHaveBeenCalledWith('vendor', {});
		await expect(useFeatureFlags().getAll()).resolves.toStrictEqual({ vendor: true });
		await expect(useFeatureFlags().list()).resolves.toStrictEqual([{ key: 'vendor', enabled: true }]);

		await useFeatureFlags().close();

		expect(driver.close).toHaveBeenCalledOnce();
	});

	test('Replaces the flags on a second registration', async () => {
		registerFeatureFlags({ flags: [{ key: 'a', enabled: true }] });

		const first = useFeatureFlags();

		registerFeatureFlags({ flags: [{ key: 'b', enabled: true }] });

		expect(useFeatureFlags()).not.toBe(first);
		await expect(useFeatureFlags().get('a')).resolves.toBe(false);
		await expect(useFeatureFlags().get('b')).resolves.toBe(true);
	});

	test('Closes nothing for a driver without close()', async () => {
		registerFeatureFlags({ flags: [] });

		// The static driver holds nothing open, so shutdown has nothing to wait for
		await expect(useFeatureFlags().close()).resolves.toBeUndefined();
	});
});
