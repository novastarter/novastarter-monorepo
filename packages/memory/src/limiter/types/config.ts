import type { Redis } from 'ioredis';

/**
 * Options every limiter configuration shares.
 */
export interface LimiterConfigAbstract {
	/**
	 * Where the consumption is tracked.
	 *
	 * `local` - Local memory. Only intended for single-process instances.
	 * `redis` - Redis instance
	 */
	type: 'local' | 'redis';

	/** Length of the window in seconds, after which a key's points are restored. */
	duration: number;

	/** Number of points every key may consume per window. */
	points: number;
}

/**
 * Configuration of the in-process limiter.
 */
export interface LimiterConfigLocal extends LimiterConfigAbstract {
	type: 'local';
}

/**
 * Configuration of the Redis-backed limiter.
 */
export interface LimiterConfigRedis extends LimiterConfigAbstract {
	type: 'redis';

	/**
	 * Prefix for every key in Redis.
	 */
	namespace: string;

	/**
	 * Existing or new Redis connection to track consumption in.
	 */
	redis: Redis;
}

/**
 * Union of the supported limiter configurations, discriminated by `type`.
 */
export type LimiterConfig = LimiterConfigLocal | LimiterConfigRedis;
