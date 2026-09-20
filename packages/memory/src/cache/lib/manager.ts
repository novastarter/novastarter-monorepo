import { DriverManager } from '@novastarter/utils';
import type { Cache } from '../types/class.js';
import type { CacheConfigLocal, CacheConfigMulti, CacheConfigRedis } from '../types/config.js';
import { CacheLocal } from './local.js';
import { CacheMulti } from './multi.js';
import { CacheRedis } from './redis.js';

/**
 * Options of a cache location: the configuration of its driver, without the `type` discriminant — the driver name
 * of the location says which one.
 */
export type CacheOptions =
	Omit<CacheConfigLocal, 'type'> | Omit<CacheConfigRedis, 'type'> | Omit<CacheConfigMulti, 'type'>;

/**
 * Registry of named caches — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for the cache: the built-in drivers (`local`, `redis`, `multi`) are registered on
 * construction, so the application only registers its locations, with the options it read from its own configuration;
 * a further driver can be registered under a name of its own. A location named `default` answers
 * {@link CacheManager.location} for every name nobody registered. The application wires it at start-up through
 * `useCache()`.
 *
 * @example
 * ```ts
 * const manager = new CacheManager();
 *
 * manager.registerLocation('schema', { driver: 'redis', options: { redis: useRedis().location('default'), namespace: 'schema', ttl: 60_000 } });
 * ```
 */
export class CacheManager extends DriverManager<Cache, CacheOptions> {
	/**
	 * Create the registry with the built-in drivers already registered.
	 */
	constructor() {
		super();

		// 1. The drivers of the package are known up front; registering them here spares every application the same
		//    lines, and a replacement under the same name still wins
		this.registerDriver('local', CacheLocal);
		this.registerDriver('redis', CacheRedis);
		this.registerDriver('multi', CacheMulti);
	}
}
