import { DriverManager } from '@novastarter/utils';
import type { BusDriver } from '../driver.js';
import { BusDriverLocal, type BusDriverLocalConfig } from './drivers/local.js';
import { BusDriverRedis, type BusDriverRedisConfig } from './drivers/redis.js';

/**
 * Bus drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in ones are listed here; an application adds a driver of its own with a module augmentation —
 * `declare module '@novastarter/memory' { interface BusDrivers { nats: BusDriverNatsConfig } }` — so a
 * location's `options` are checked against the driver it names.
 */
export interface BusDrivers {
	/** {@link BusDriverLocal}. */
	local: BusDriverLocalConfig;
	/** {@link BusDriverRedis}. */
	redis: BusDriverRedisConfig;
}

/**
 * Registry of named message buses — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for the message bus: the built-in drivers (`local`, `redis`) are registered on
 * construction, so the application only registers its locations, with the options it read from its own configuration;
 * a location is built on its first use. A further driver can be registered under a name of its own once it joined
 * {@link BusDrivers}. The application wires it at start-up through {@link useBus}.
 *
 * @example
 * ```ts
 * const manager = new BusManager();
 *
 * manager.registerLocation('default', {
 * 	driver: 'redis',
 * 	options: {
 * 		redis: useRedis().location('default'),
 * 		namespace: 'novastarter',
 * 	},
 * });
 * ```
 */
export class BusManager extends DriverManager<BusDriver, BusDrivers> {
	/**
	 * Create the registry with the built-in drivers already registered.
	 */
	constructor() {
		super();

		// The drivers of the package are known up front; registering them here spares every application the same lines,
		// and a replacement under the same name still wins
		this.registerDriver('local', BusDriverLocal);
		this.registerDriver('redis', BusDriverRedis);
	}
}
