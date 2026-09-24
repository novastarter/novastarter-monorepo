import { DriverManager } from '@novastarter/utils';
import type { LimiterDriver } from '../driver.js';
import { LimiterDriverLocal, type LimiterDriverLocalConfig } from './drivers/local.js';
import { LimiterDriverRedis, type LimiterDriverRedisConfig } from './drivers/redis.js';

/**
 * Limiter drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * The built-in ones are listed here; an application adds a driver of its own with a module augmentation —
 * `declare module '@novastarter/memory' { interface LimiterDrivers { memcached: LimiterDriverMemcachedConfig } }` — so a
 * location's `options` are checked against the driver it names.
 */
export interface LimiterDrivers {
	/** {@link LimiterDriverLocal}. */
	local: LimiterDriverLocalConfig;
	/** {@link LimiterDriverRedis}. */
	redis: LimiterDriverRedisConfig;
}

/**
 * Registry of named rate limiters — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for the rate limiter: the built-in drivers (`local`, `redis`) are registered on
 * construction, so the application only registers its locations, with the options it read from its own configuration;
 * a location is built on its first use. A further driver can be registered under a name of its own once it joined
 * {@link LimiterDrivers}. The application wires it at start-up through {@link useLimiter}.
 *
 * @example
 * ```ts
 * const manager = new LimiterManager();
 *
 * manager.registerLocation('api', {
 * 	driver: 'redis',
 * 	options: {
 * 		redis: useRedis().location('default'),
 * 		namespace: 'api',
 * 		points: 50,
 * 		duration: 1,
 * 	},
 * });
 * ```
 */
export class LimiterManager extends DriverManager<LimiterDriver, LimiterDrivers> {
	/**
	 * Create the registry with the built-in drivers already registered.
	 */
	constructor() {
		super();

		// The drivers of the package are known up front; registering them here spares every application the same lines,
		// and a replacement under the same name still wins
		this.registerDriver('local', LimiterDriverLocal);
		this.registerDriver('redis', LimiterDriverRedis);
	}
}
