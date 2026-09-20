import { DriverManager } from '@novastarter/utils';
import type { Cache } from '../types/class.js';
import type { CacheLocalOptions, CacheMultiOptions, CacheRedisOptions } from '../types/config.js';
import { CacheLocal } from './local.js';
import { CacheMulti } from './multi.js';
import { CacheRedis } from './redis.js';

/**
 * Cache drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in ones are listed here; an application adds a driver of its own with a module augmentation —
 * `declare module '@novastarter/memory' { interface CacheDrivers { memcached: MemcachedOptions } }` — so a
 * location's `options` are checked against the driver it names.
 */
export interface CacheDrivers {
	/** CacheLocal. */
	local: CacheLocalOptions;
	/** CacheRedis. */
	redis: CacheRedisOptions;
	/** CacheMulti. */
	multi: CacheMultiOptions;
}

/**
 * Registry of named caches — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for the cache: the built-in drivers (`local`, `redis`, `multi`) are registered on
 * construction, so the application only registers its locations, with the options it read from its own configuration;
 * a location is built on its first use. A further driver can be registered under a name of its own once it joined
 * {@link CacheDrivers}. The application wires it at start-up through `useCache()`.
 *
 * @example
 * ```ts
 * const manager = new CacheManager();
 *
 * manager.registerLocation('schema', { driver: 'redis', options: { redis: useRedis().location('default'), namespace: 'schema', ttl: 60_000 } });
 * ```
 */
export class CacheManager extends DriverManager<Cache, CacheDrivers> {
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
