import { type Singleton, singleton } from '@novastarter/utils';
import type { FeatureFlagsDriver } from '../driver.js';
import type { FeatureFlagDefinition } from '../types.js';
import { FeatureFlagsDriverStatic } from './drivers/static.js';
import { FeatureFlags } from './feature-flags.js';

/**
 * What {@link registerFeatureFlags} takes: the flags themselves, served by the built-in static driver, or a driver of
 * the application's own.
 */
export type RegisterFeatureFlagsOptions =
	| {
			/** Every flag of the application, with its switch and rules; see {@link FeatureFlagsDriverStatic}. */
			flags: FeatureFlagDefinition[];
	  }
	| {
			/** A ready driver — a table, a vendor — for flags that change without a restart. */
			driver: FeatureFlagsDriver;
	  };

/**
 * Return the process-wide {@link FeatureFlags}, the ones given to {@link registerFeatureFlags}.
 *
 * @returns The same object on every call; `useFeatureFlags.reset()` drops it, for tests.
 * @throws Error before {@link registerFeatureFlags} ran: answering "off" instead would turn a forgotten registration
 * into features silently gone.
 * @example
 * ```ts
 * await useFeatureFlags().get('new-billing', { user: session.user, organization: session.organization });
 * ```
 */
export const useFeatureFlags: Singleton<FeatureFlags> = singleton(() => {
	// 1. Nothing to build from: the flags are the application's, so only its registration can provide them
	throw new Error('Feature flags are not registered; call registerFeatureFlags() at start-up.');
});

/**
 * Make a set of feature flags the process-wide one.
 *
 * What the application calls at start-up, once, with the flags it built from its own configuration, or with a driver
 * of its own. Registering again replaces the flags for every later `useFeatureFlags()` call; the replaced driver is not
 * closed, since the application's shutdown closes it before booting again.
 *
 * @param options - The flags, or a driver.
 * @throws ZodError for a flag that is not one: a bad key, a percentage out of range.
 * @throws Error when two flags share a key.
 * @example
 * ```ts
 * registerFeatureFlags({
 * 	flags: [
 * 		{ key: 'beta-ai', enabled: true },
 * 		{ key: 'new-billing', enabled: env.FEATURE_NEW_BILLING, rules: { percentage: 10 } },
 * 	],
 * });
 *
 * registerFeatureFlags({ driver: new FeatureFlagsDriverVendor({ apiKey: env.FLAGS_API_KEY }) });
 * ```
 */
export const registerFeatureFlags = (options: RegisterFeatureFlagsOptions): void => {
	// 1. Plain flags go through the static driver, built here so a mistake in them fails the boot rather than a request
	const driver = 'driver' in options ? options.driver : new FeatureFlagsDriverStatic({ flags: options.flags });

	// 2. Replace rather than merge: the registration is the whole set of flags of the process
	useFeatureFlags.replace(new FeatureFlags(driver));
};
