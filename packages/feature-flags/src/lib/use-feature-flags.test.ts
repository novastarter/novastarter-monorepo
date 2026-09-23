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
		// 1. A forgotten registration fails loudly instead of switching every feature off
		expect(() => useFeatureFlags()).toThrowErrorMatchingInlineSnapshot(
			`[Error: Feature flags are not registered; call registerFeatureFlags() at start-up.]`,
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

		// 1. One object for the process, with the rules of the flags applied
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
		// 1. The static driver is built by the registration, so a bad key fails the boot rather than a request
		expect(() => registerFeatureFlags({ flags: [{ key: 'Bad Key', enabled: true }] })).toThrow();
		expect(() => useFeatureFlags()).toThrow();
	});

	test('Serves a driver of the application and closes it on shutdown', async () => {
		// 1. A stand-in for a table or a vendor, recording what the flags ask of it
		const driver: FeatureFlagsDriver = {
			get: vi.fn(async () => true),
			getAll: vi.fn(async () => ({ vendor: true })),
			list: vi.fn(async () => [{ key: 'vendor', enabled: true }]),
			close: vi.fn(async () => undefined),
		};

		registerFeatureFlags({ driver });

		// 2. Every call goes to the driver, with an empty context when the caller gave none
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

		// 1. The second set is the whole set: the flag of the first one is gone
		registerFeatureFlags({ flags: [{ key: 'b', enabled: true }] });

		expect(useFeatureFlags()).not.toBe(first);
		await expect(useFeatureFlags().get('a')).resolves.toBe(false);
		await expect(useFeatureFlags().get('b')).resolves.toBe(true);
	});

	test('Closes nothing for a driver without close()', async () => {
		registerFeatureFlags({ flags: [] });

		// 1. The static driver holds nothing open, so shutdown has nothing to wait for
		await expect(useFeatureFlags().close()).resolves.toBeUndefined();
	});
});
