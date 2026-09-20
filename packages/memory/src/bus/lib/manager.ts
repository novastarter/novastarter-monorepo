import { DriverManager } from '@novastarter/utils';
import type { Bus } from '../types/class.js';
import type { BusConfigLocal, BusConfigRedis } from '../types/config.js';
import { BusLocal } from './local.js';
import { BusRedis } from './redis.js';

/**
 * Options of a bus location: the configuration of its driver, without the `type` discriminant — the driver name
 * of the location says which one.
 */
export type BusOptions = Omit<BusConfigLocal, 'type'> | Omit<BusConfigRedis, 'type'>;

/**
 * Registry of named message buss — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for the message bus: the built-in drivers (`local`, `redis`) are registered on
 * construction, so the application only registers its locations, with the options it read from its own configuration;
 * a further driver can be registered under a name of its own. A location named `default` answers
 * {@link BusManager.location} for every name nobody registered. The application wires it at start-up through
 * `useBus()`.
 *
 * @example
 * ```ts
 * const manager = new BusManager();
 *
 * manager.registerLocation('default', { driver: 'redis', options: { redis: useRedis().location('default'), namespace: 'novastarter' } });
 * ```
 */
export class BusManager extends DriverManager<Bus, BusOptions> {
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
