import { type Singleton, singleton } from '@novastarter/utils';
import { FeatureFlagsManager } from './feature-flags-manager.js';

/**
 * Return the process-wide {@link FeatureFlagsManager}, creating one with the built-in driver on first use.
 *
 * The application registers its locations on it at start-up; every later caller gets the same instance, so the flags
 * are shared across the process.
 *
 * @returns The same manager on every call; `useFeatureFlags.reset()` drops it, for tests.
 * @example
 * ```ts
 * // at start-up
 * useFeatureFlags().registerLocation('default', {
 * 	driver: 'static',
 * 	options: {
 * 		flags: [{ key: 'new-billing', enabled: env.FEATURE_NEW_BILLING }],
 * 	},
 * });
 *
 * // anywhere later
 * await useFeatureFlags().location('default').get('new-billing', { user: session.user });
 * ```
 */
export const useFeatureFlags: Singleton<FeatureFlagsManager> = singleton(() => new FeatureFlagsManager());
