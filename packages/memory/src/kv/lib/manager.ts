import { DriverManager } from '@novastarter/utils';
import type { Kv } from '../types/class.js';
import type { KvLocalOptions, KvRedisOptions } from '../types/config.js';
import { KvLocal } from './local.js';
import { KvRedis } from './redis.js';

/**
 * Kv drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in ones are listed here; an application adds a driver of its own with a module augmentation —
 * `declare module '@novastarter/memory' { interface KvDrivers { memcached: MemcachedOptions } }` — so a
 * location's `options` are checked against the driver it names.
 */
export interface KvDrivers {
	/** KvLocal. */
	local: KvLocalOptions;
	/** KvRedis. */
	redis: KvRedisOptions;
}

/**
 * Registry of named key-value stores — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for the key-value store: the built-in drivers (`local`, `redis`) are registered on
 * construction, so the application only registers its locations, with the options it read from its own configuration;
 * a location is built on its first use. A further driver can be registered under a name of its own once it joined
 * {@link KvDrivers}. The application wires it at start-up through `useKv()`.
 *
 * @example
 * ```ts
 * const manager = new KvManager();
 *
 * manager.registerLocation('sessions', { driver: 'redis', options: { redis: useRedis().location('default'), namespace: 'sessions' } });
 * ```
 */
export class KvManager extends DriverManager<Kv, KvDrivers> {
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
