import { DriverManager } from '@novastarter/utils';
import type { Limiter } from '../types/class.js';
import type { LimiterConfigLocal, LimiterConfigRedis } from '../types/config.js';
import { LimiterLocal } from './local.js';
import { LimiterRedis } from './redis.js';

/**
 * Options of a limiter location: the configuration of its driver, without the `type` discriminant — the driver name
 * of the location says which one.
 */
export type LimiterOptions = Omit<LimiterConfigLocal, 'type'> | Omit<LimiterConfigRedis, 'type'>;

/**
 * Registry of named rate limiters — locations — and the driver instance behind each.
 *
 * The {@link DriverManager} of the kit for the rate limiter: the built-in drivers (`local`, `redis`) are registered on
 * construction, so the application only registers its locations, with the options it read from its own configuration;
 * a further driver can be registered under a name of its own. A location named `default` answers
 * {@link LimiterManager.location} for every name nobody registered. The application wires it at start-up through
 * `useLimiter()`.
 *
 * @example
 * ```ts
 * const manager = new LimiterManager();
 *
 * manager.registerLocation('api', { driver: 'redis', options: { redis: useRedis().location('default'), namespace: 'api', points: 50, duration: 1 } });
 * ```
 */
export class LimiterManager extends DriverManager<Limiter, LimiterOptions> {
	/**
	 * Create the registry with the built-in drivers already registered.
	 */
	constructor() {
		super();

		// 1. The drivers of the package are known up front; registering them here spares every application the same
		//    lines, and a replacement under the same name still wins
		this.registerDriver('local', LimiterLocal);
		this.registerDriver('redis', LimiterRedis);
	}
}
