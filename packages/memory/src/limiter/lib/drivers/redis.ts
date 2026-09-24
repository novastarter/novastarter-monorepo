import type { Redis } from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import type { LimiterDriver } from '../../driver.js';
import type { LimiterDriverConfigBase } from '../../types.js';
import { assertBudget } from '../../utils/assert-budget.js';
import { consume } from '../../utils/consume.js';

/**
 * Options of {@link LimiterDriverRedis}, the `redis` driver.
 */
export type LimiterDriverRedisConfig = LimiterDriverConfigBase & {
	/**
	 * Prefix for every key in Redis.
	 */
	namespace: string;

	/**
	 * Existing or new Redis connection to track consumption in.
	 */
	redis: Redis;
};

/**
 * Rate limiter over `rate-limiter-flexible`'s Redis store, enforcing one budget across processes.
 *
 * @example
 * ```ts
 * const limiter = new LimiterDriverRedis({
 * 	redis: new Redis(),
 * 	namespace: 'app',
 * 	points: 10,
 * 	duration: 5,
 * });
 *
 * await limiter.consume(request.ip);
 * ```
 */
export class LimiterDriverRedis implements LimiterDriver {
	/**
	 * Underlying limiter doing the bookkeeping in Redis.
	 *
	 * @internal
	 */
	private readonly limiter: RateLimiterRedis;

	/**
	 * Configured points per window, reported in the error when a key runs out.
	 *
	 * @internal
	 */
	private readonly points: number;

	/**
	 * Create the limiter on top of an existing Redis connection.
	 *
	 * @param config - Redis configuration.
	 * @throws `InvalidConfigError` when `duration` is not a whole number of seconds of at least 1, or `points` is not a whole
	 * number of at least 0.
	 */
	constructor(config: LimiterDriverRedisConfig) {
		// The library floors the window to whole seconds for Redis' `EX`, and a window of zero seconds sets no expiry
		// at all: a key would stay over budget for good. Refused here, before the first key is written
		assertBudget('LimiterDriverRedis', config);

		// The namespace becomes the library's key prefix, keeping limiter keys apart from other data in Redis
		this.limiter = new RateLimiterRedis({
			storeClient: config.redis,
			keyPrefix: config.namespace,
			points: config.points,
			duration: config.duration,
		});

		this.points = config.points;
	}

	/**
	 * Consume one point for the given key.
	 *
	 * @param key - IP address, URL path or any other string identifying the caller.
	 * @throws `HitRateLimitError` when the key has no points left in the current window.
	 */
	async consume(key: string): Promise<void> {
		// The shared handler translates the library's rejection into a `HitRateLimitError`
		return await consume(this.limiter, key, this.points);
	}

	/**
	 * Forget the tracked consumption of a key.
	 *
	 * @param key - IP address, URL path or any other string identifying the caller.
	 */
	async delete(key: string): Promise<void> {
		// The key lives under the library's prefix in Redis, so only the library can address it
		await this.limiter.delete(key);
	}
}
