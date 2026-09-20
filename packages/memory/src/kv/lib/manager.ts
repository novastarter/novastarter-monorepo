import { DriverManager } from '@novastarter/utils';
import type { Kv } from '../types/class.js';
import type { KvConfigLocal, KvConfigRedis } from '../types/config.js';
import { KvLocal } from './local.js';
import { KvRedis } from './redis.js';

/**
 * Options of a kv location: the configuration of its driver, without the `type` discriminant — the driver name
 * of the location says which one.
 */
export type KvOptions = Omit<KvConfigLocal, 'type'> | Omit<KvConfigRedis, 'type'>;

/**
 * Registry of named key-value stores — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for the key-value store: the built-in drivers (`local`, `redis`) are registered on
 * construction, so the application only registers its locations, with the options it read from its own configuration;
 * a further driver can be registered under a name of its own. A location named `default` answers
 * {@link KvManager.location} for every name nobody registered. The application wires it at start-up through
 * `useKv()`.
 *
 * @example
 * ```ts
 * const manager = new KvManager();
 *
 * manager.registerLocation('sessions', { driver: 'redis', options: { redis: useRedis().location('default'), namespace: 'sessions' } });
 * ```
 */
export class KvManager extends DriverManager<Kv, KvOptions> {
	/**
	 * Create the registry with the built-in drivers already registered.
	 */
	constructor() {
		super();

		// 1. The drivers of the package are known up front; registering them here spares every application the same
		//    lines, and a replacement under the same name still wins
		this.registerDriver('local', KvLocal);
		this.registerDriver('redis', KvRedis);
	}
}
