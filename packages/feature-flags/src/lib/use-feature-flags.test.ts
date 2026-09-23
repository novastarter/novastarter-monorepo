/**
 * Tests of `feature-flags/lib/use-feature-flags`: one manager per process, resettable.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { FeatureFlagsManager } from './feature-flags-manager.js';
import { useFeatureFlags } from './use-feature-flags.js';

afterEach(() => {
	useFeatureFlags.reset();
});

describe('useFeatureFlags', () => {
	test('Returns the same manager on every call', () => {
		// 1. Built on the first call, cached for every later one
		const first = useFeatureFlags();

		expect(first).toBeInstanceOf(FeatureFlagsManager);
		expect(useFeatureFlags()).toBe(first);
	});

	test('Shares the registrations with every later caller', async () => {
		// 1. A location registered at start-up is visible everywhere, and built once
		useFeatureFlags().registerLocation('default', {
			driver: 'static',
			options: {
				flags: [{ key: 'new-billing', enabled: true }],
			},
		});

		expect(useFeatureFlags().location('default')).toBe(useFeatureFlags().location('default'));
		await expect(useFeatureFlags().location('default').get('new-billing', {})).resolves.toBe(true);
	});
});
