import type { FeatureFlagsDriver } from '../driver.js';
import type { FeatureFlagContext, FeatureFlagDefinition, FeatureFlagValues } from '../types.js';

/**
 * The feature flags of the process: what the code asks — is this feature on for this caller — over the one driver
 * the application registered.
 *
 * An application has one set of flags, so there are no named locations: {@link registerFeatureFlags} builds this
 * object once at start-up and `useFeatureFlags()` hands it out.
 *
 * @example
 * ```ts
 * const flags = new FeatureFlags(new FeatureFlagsDriverStatic({ flags: [{ key: 'new-billing', enabled: true }] }));
 *
 * await flags.get('new-billing', { user: 'u1' }); // true
 * ```
 */
export class FeatureFlags {
	/**
	 * Create the flags over a driver.
	 *
	 * @param driver - Where the flags come from.
	 */
	constructor(private readonly driver: FeatureFlagsDriver) {}

	/**
	 * Whether a flag is on for a caller.
	 *
	 * @param key - The flag's key.
	 * @param context - Who is asking; nobody, for a flag decided without a caller.
	 * @returns `true` when on; `false` when off or not defined.
	 */
	async get(key: string, context: FeatureFlagContext = {}): Promise<boolean> {
		return this.driver.get(key, context);
	}

	/**
	 * Every flag, evaluated for a caller — what a page hands the client so it can decide without a round trip.
	 *
	 * @param context - Who is asking.
	 * @returns Key → on or off.
	 */
	async getAll(context: FeatureFlagContext = {}): Promise<FeatureFlagValues> {
		return this.driver.getAll(context);
	}

	/**
	 * The definitions the driver holds, for a listing of the flags.
	 *
	 * @returns The definitions.
	 */
	async list(): Promise<FeatureFlagDefinition[]> {
		return this.driver.list();
	}

	/**
	 * Release what the driver holds, at shutdown.
	 *
	 * @returns Once the driver is closed; at once for a driver with nothing to close.
	 */
	async close(): Promise<void> {
		await this.driver.close?.();
	}
}
