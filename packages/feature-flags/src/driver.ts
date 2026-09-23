import type { FeatureFlagContext, FeatureFlagDefinition, FeatureFlagValues } from './types.js';

/**
 * Contract every source of feature flags implements.
 *
 * The application hands a ready instance to `registerFeatureFlags({ driver })`, so the contract says nothing about
 * construction. Where the flags come from — the app's configuration, a table, a vendor — is the driver's business; a
 * flag the driver does not know is off.
 */
export interface FeatureFlagsDriver {
	/**
	 * Whether a flag is on for a context.
	 *
	 * @param key - The flag's key.
	 * @param context - Who is asking.
	 * @returns `true` when on; `false` for a flag that is off, or that the driver does not know.
	 */
	get(key: string, context: FeatureFlagContext): Promise<boolean>;

	/**
	 * Every flag the driver knows, evaluated for a context.
	 *
	 * @param context - Who is asking.
	 * @returns Key → on or off.
	 */
	getAll(context: FeatureFlagContext): Promise<FeatureFlagValues>;

	/**
	 * The definitions the driver holds, for a listing of the flags.
	 *
	 * @returns The definitions.
	 */
	list(): Promise<FeatureFlagDefinition[]>;

	/**
	 * Release what the driver holds — a client, a subscription — so the process can exit.
	 *
	 * Optional: a driver that keeps nothing open has nothing to release.
	 *
	 * @returns Once everything is released.
	 */
	close?(): Promise<void>;
}
