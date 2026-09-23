import { z } from 'zod';

/**
 * Who is asking whether a flag is on: the user and the organization of the request, either or both.
 *
 * A flag with rules is decided against them; a flag without rules ignores them.
 */
export interface FeatureFlagContext {
	/** The user's id. */
	user?: string | null | undefined;
	/** The organization's id — the active one of a session, or the one a call is about. */
	organization?: string | null | undefined;
}

/**
 * Who sees a feature while its flag is enabled.
 *
 * Every rule that is set is a way in: a caller matching any of them sees the feature. No rules at all means everyone.
 */
export interface FeatureFlagRules {
	/** User ids the feature is on for. */
	users?: string[] | undefined;
	/** Organization ids the feature is on for. */
	organizations?: string[] | undefined;
	/**
	 * A gradual rollout: the share of subjects, 0–100, the feature is on for.
	 *
	 * The subject is the user, else the organization; the same subject always lands on the same side, because its
	 * bucket is a hash of the flag's key and the subject's id.
	 */
	percentage?: number | undefined;
}

/**
 * A flag as a driver knows it: the master switch and the rules.
 */
export interface FeatureFlagDefinition {
	/** `new-billing`: lower-case letters, digits and dashes, starting with a letter. */
	key: string;
	/** What the flag is for, for whoever reads a listing of the flags. */
	description?: string | null | undefined;
	/** The master switch: while it is off, no rule matters and the flag is off for everyone. */
	enabled: boolean;
	/** `null` for a flag without rules — on for everyone while enabled. */
	rules?: FeatureFlagRules | null | undefined;
}

/**
 * What every flag evaluates to for one context: the flag's key to on or off.
 */
export type FeatureFlagValues = Record<string, boolean>;

/**
 * The shape of a flag's key.
 *
 * Lower-case with dashes, so the same key reads the same in code, in a URL and in an environment variable name once
 * upper-cased.
 *
 * @defaultValue `/^[a-z][a-z0-9-]*$/`
 */
export const FEATURE_FLAG_KEY_PATTERN: RegExp = /^[a-z][a-z0-9-]*$/;

/**
 * A flag's key: {@link FEATURE_FLAG_KEY_PATTERN}, at most 64 characters.
 */
export const featureFlagKeySchema: z.ZodString = z.string().min(1).max(64).regex(FEATURE_FLAG_KEY_PATTERN);

/**
 * The rules of a flag: ids as non-empty strings, the percentage a whole number of 0–100.
 */
export const featureFlagRulesSchema: z.ZodType<FeatureFlagRules> = z.object({
	users: z.array(z.string().min(1)).optional(),
	organizations: z.array(z.string().min(1)).optional(),
	percentage: z.number().int().min(0).max(100).optional(),
});

/**
 * A whole flag definition, as a driver accepts one.
 */
export const featureFlagDefinitionSchema: z.ZodType<FeatureFlagDefinition> = z.object({
	key: featureFlagKeySchema,
	description: z.string().nullable().optional(),
	enabled: z.boolean(),
	rules: featureFlagRulesSchema.nullable().optional(),
});
