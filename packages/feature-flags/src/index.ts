/**
 * Public entry point of `@novastarter/feature-flags`.
 *
 * Feature flags in three parts: the {@link FeatureFlagsDriver} contract with the built-in
 * {@link FeatureFlagsDriverStatic}, the process-wide {@link FeatureFlags} set up by {@link registerFeatureFlags} and
 * handed out by {@link useFeatureFlags}, and the rules every driver applies — {@link evaluateFeatureFlag} over a
 * {@link FeatureFlagDefinition}, with the rollout buckets of {@link bucketOf}.
 */
export type { FeatureFlagsDriver } from './driver.js';
export { FeatureFlagsDriverStatic } from './lib/drivers/index.js';
export type { FeatureFlagsDriverStaticConfig } from './lib/drivers/index.js';
export { evaluateFeatureFlag } from './lib/evaluate.js';
export { FeatureFlags } from './lib/feature-flags.js';
export { bucketOf, isInRollout } from './lib/percentage.js';
export { registerFeatureFlags, useFeatureFlags } from './lib/use-feature-flags.js';
export type { RegisterFeatureFlagsOptions } from './lib/use-feature-flags.js';
export {
	FEATURE_FLAG_KEY_PATTERN,
	featureFlagDefinitionSchema,
	featureFlagKeySchema,
	featureFlagRulesSchema,
} from './types.js';
export type { FeatureFlagContext, FeatureFlagDefinition, FeatureFlagRules, FeatureFlagValues } from './types.js';
