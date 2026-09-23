/**
 * Public entry point of `@novastarter/feature-flags`.
 *
 * Feature flags in three parts: the {@link FeatureFlagsDriver} contract with the built-in
 * {@link FeatureFlagsDriverStatic}, the {@link FeatureFlagsManager} of {@link useFeatureFlags} mapping named locations
 * to drivers, and the rules every driver applies — {@link evaluateFeatureFlag} over a {@link FeatureFlagDefinition},
 * with the rollout buckets of {@link bucketOf}.
 */
export * from './driver.js';
export * from './lib/drivers/index.js';
export * from './lib/evaluate.js';
export * from './lib/feature-flags-manager.js';
export * from './lib/percentage.js';
export * from './lib/use-feature-flags.js';
export * from './types.js';
