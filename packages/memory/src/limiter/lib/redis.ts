import { RateLimiterRedis } from 'rate-limiter-flexible';
import type { Limiter } from '../types/class.js';
import type { LimiterDriverRedisConfig } from '../types/config.js';
import { consume } from '../utils/consume.js';

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
export class LimiterDriverRedis implements Limiter {
	/**
	 * Underlying limiter doing the bookkeeping in Redis.
	 *
	 * @internal
	 */
	private limiter: RateLimiterRedis;

	/**
	 * Configured points per window, reported in the error when a key runs out.
	 *
	 * @internal
	 */
	private points: number;

	/**
	 * Create the limiter on top of an existing Redis connection.
	 *
	 * @param config - Redis configuration.
	 */
	constructor(config: LimiterDriverRedisConfig) {
		// 1. The namespace becomes the library's key prefix, keeping limiter keys apart from other data in Redis
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
		// 1. The shared handler translates the library's rejection into a `HitRateLimitError`
		return await consume(this.limiter, key, this.points);
	}

	/**
	 * Forget the tracked consumption of a key.
	 *
	 * @param key - IP address, URL path or any other string identifying the caller.
	 */
	async delete(key: string): Promise<void> {
		// 1. Delegate to the library
		await this.limiter.delete(key);
	}
}
