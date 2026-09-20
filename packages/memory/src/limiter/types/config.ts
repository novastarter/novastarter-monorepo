import type { Redis } from 'ioredis';

/**
 * Options every limiter shares: the budget of a key.
 */
export interface LimiterOptionsBase {
	/** Length of the window in seconds, after which a key's points are restored. */
	duration: number;

	/** Number of points every key may consume per window. */
	points: number;
}

/**
 * Options of the in-process limiter, the `local` driver; the budget alone.
 */
export type LimiterLocalOptions = LimiterOptionsBase;

/**
 * Options of the Redis-backed limiter, the `redis` driver.
 */
export interface LimiterRedisOptions extends LimiterOptionsBase {
	/**
	 * Prefix for every key in Redis.
	 */
	namespace: string;

	/**
	 * Existing or new Redis connection to track consumption in.
	 */
	redis: Redis;
}
