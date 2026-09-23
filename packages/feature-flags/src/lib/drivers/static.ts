import type { FeatureFlagsDriver } from '../../driver.js';
import {
	type FeatureFlagContext,
	type FeatureFlagDefinition,
	featureFlagDefinitionSchema,
	type FeatureFlagValues,
} from '../../types.js';
import { evaluateFeatureFlag } from '../evaluate.js';

/**
 * Options accepted by {@link FeatureFlagsDriverStatic}.
 */
export interface FeatureFlagsDriverStaticConfig {
	/** Every flag of the location, with its switch and rules. A key may appear once. */
	flags: FeatureFlagDefinition[];
}

/**
 * Feature flags handed over by the application at start-up.
 *
 * The flags are fixed for the life of the process: the application builds them from its own configuration — its
 * environment, a file — and a change is a restart. The rules by user, organization and percentage apply as with any
 * other driver.
 *
 * @example
 * ```ts
 * const flags = useFeatureFlags();
 *
 * flags.registerLocation('default', {
 * 	driver: 'static',
 * 	options: {
 * 		flags: [
 * 			{ key: 'new-billing', enabled: env.FEATURE_NEW_BILLING, rules: { percentage: 10 } },
 * 		],
 * 	},
 * });
 *
 * await flags.location('default').get('new-billing', { user: 'u1' });
 * ```
 */
export class FeatureFlagsDriverStatic implements FeatureFlagsDriver {
	/**
	 * The definitions by key, for a lookup per evaluation without a scan.
	 *
	 * @internal
	 */
	private readonly flags: Map<string, FeatureFlagDefinition>;

	/**
	 * Create the driver from the application's flags.
	 *
	 * @param config - The flags.
	 * @throws ZodError for a definition that is not one: a bad key, a percentage out of range.
	 * @throws Error when two definitions share a key.
	 */
	constructor(config: FeatureFlagsDriverStaticConfig) {
		this.flags = new Map();

		for (const definition of config.flags) {
			// 1. Validated here, since the manager builds the driver on first use: a typo fails there, not silently later
			const valid = featureFlagDefinitionSchema.parse(definition);

			// 2. A duplicate key is a configuration mistake: which of the two wins would depend on the order
			if (this.flags.has(valid.key)) {
				throw new Error(`Feature flag "${valid.key}" is defined twice.`);
			}

			this.flags.set(valid.key, valid);
		}
	}

	/**
	 * Whether a flag is on for a context; off for a flag the application did not define.
	 *
	 * @param key - The flag's key.
	 * @param context - Who is asking.
	 * @returns On or off.
	 */
	async get(key: string, context: FeatureFlagContext): Promise<boolean> {
		// 1. An unknown flag is off, so code can ship behind a flag before the flag is configured
		const definition = this.flags.get(key);

		return definition ? evaluateFeatureFlag(definition, context) : false;
	}

	/**
	 * Every flag, evaluated for a context.
	 *
	 * @param context - Who is asking.
	 * @returns Key → on or off.
	 */
	async getAll(context: FeatureFlagContext): Promise<FeatureFlagValues> {
		// 1. One pass over the definitions, in the order the application gave them
		return Object.fromEntries(
			[...this.flags.values()].map((definition) => [definition.key, evaluateFeatureFlag(definition, context)]),
		);
	}

	/**
	 * The definitions, in the order the application gave them.
	 *
	 * @returns Copies of the definitions, so a caller cannot change the flags of the process by mutating them.
	 */
	async list(): Promise<FeatureFlagDefinition[]> {
		// 1. `structuredClone` copies the nested rule arrays too, which a spread would share
		return [...this.flags.values()].map((definition) => structuredClone(definition));
	}
}
