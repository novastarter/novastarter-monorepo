import { DriverManager } from '@novastarter/utils';
import type { Bus } from '../types/class.js';
import type { BusLocalOptions, BusRedisOptions } from '../types/config.js';
import { BusLocal } from './local.js';
import { BusRedis } from './redis.js';

/**
 * Bus drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in ones are listed here; an application adds a driver of its own with a module augmentation —
 * `declare module '@novastarter/memory' { interface BusDrivers { memcached: MemcachedOptions } }` — so a
 * location's `options` are checked against the driver it names.
 */
export interface BusDrivers {
	/** BusLocal. */
	local: BusLocalOptions;
	/** BusRedis. */
	redis: BusRedisOptions;
}

/**
 * Registry of named message buss — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for the message bus: the built-in drivers (`local`, `redis`) are registered on
 * construction, so the application only registers its locations, with the options it read from its own configuration;
 * a location is built on its first use. A further driver can be registered under a name of its own once it joined
 * {@link BusDrivers}. The application wires it at start-up through `useBus()`.
 *
 * @example
 * ```ts
 * const manager = new BusManager();
 *
 * manager.registerLocation('default', { driver: 'redis', options: { redis: useRedis().location('default'), namespace: 'novastarter' } });
 * ```
 */
export class BusManager extends DriverManager<Bus, BusDrivers> {
	/**
	 * Create the registry with the built-in drivers already registered.
	 */
	constructor() {
		super();

		// 1. The drivers of the package are known up front; registering them here spares every application the same
		//    lines, and a replacement under the same name still wins
		this.registerDriver('local', BusLocal);
		this.registerDriver('redis', BusRedis);
	}
}
