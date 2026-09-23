import { DriverManager } from '@novastarter/utils';
import type { FeatureFlagsDriver } from '../driver.js';
import { FeatureFlagsDriverStatic, type FeatureFlagsDriverStaticConfig } from './drivers/static.js';

/**
 * Feature flags drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in one is listed here; a driver package or an application adds its own with a module augmentation —
 * `declare module '@novastarter/feature-flags' { interface FeatureFlagsDrivers { vendor: VendorConfig } }` — so a
 * location's `options` are checked against the driver it names.
 */
export interface FeatureFlagsDrivers {
	/** {@link FeatureFlagsDriverStatic}. */
	static: FeatureFlagsDriverStaticConfig;
}

/**
 * Registry of named sets of feature flags — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for feature flags: the built-in `static` driver is registered on construction,
 * so the application only registers its locations, with the flags it built from its own configuration; a location is
 * built on its first use. The application wires it at start-up through `useFeatureFlags()`.
 *
 * @example
 * ```ts
 * const manager = new FeatureFlagsManager();
 *
 * manager.registerLocation('default', {
 * 	driver: 'static',
 * 	options: {
 * 		flags: [{ key: 'new-billing', enabled: true }],
 * 	},
 * });
 *
 * await manager.location('default').get('new-billing', { user: 'u1' });
 * ```
 */
export class FeatureFlagsManager extends DriverManager<FeatureFlagsDriver, FeatureFlagsDrivers> {
	/**
	 * Create the registry with the built-in driver already registered.
	 */
	constructor() {
		super();

		// 1. The driver of the package is known up front; registering it here spares every application the same line,
		//    and a replacement under the same name still wins
		this.registerDriver('static', FeatureFlagsDriverStatic);
	}
}
