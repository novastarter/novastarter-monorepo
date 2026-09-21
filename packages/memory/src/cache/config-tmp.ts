import type { Redis } from 'ioredis';

/**
 * Options of the in-memory cache, the `local` driver.
 */
export type CacheDriverLocalConfig = {
	/**
	 * Maximum number of keys in the cache; the least recently used key is evicted beyond it.
	 */
	maxKeys?: number | undefined;

	/**
	 * Time-to-live: keys expire after this many milliseconds.
	 */
	ttl?: number | undefined;
};

/**
 * Options of the Redis-backed cache, the `redis` driver.
 */
export type CacheDriverRedisConfig = {
	/**
	 * Prefix for every key, so several caches can share one Redis instance.
	 */
	namespace: string;

	/**
	 * Enable gzip compression of cached values.
	 *
	 * @default true
	 */
	compression?: boolean | undefined;

	/**
	 * Minimum byte size of a value before it is compressed.
	 *
	 * There is a trade-off between size and the time spent gzipping; below roughly 1 kB the savings do not pay for
	 * the CPU time.
	 *
	 * @default 1000
	 */
	compressionMinSize?: number | undefined;

	/**
	 * Time-to-live: keys expire after this many milliseconds.
	 */
	ttl?: number | undefined;

	/**
	 * Existing or new Redis connection to use with this cache.
	 */
	redis: Redis;
};

/**
 * Options of the multi-stage cache, the `multi` driver: a local L1 in front of a Redis L2.
 */
export type CacheDriverMultiConfig = {
	/**
	 * Configuration of the L1 (in-memory) cache.
	 */
	local: CacheDriverLocalConfig;

	/**
	 * Configuration of the L2 (Redis) cache; its connection and namespace are also used for the invalidation bus.
	 */
	redis: CacheDriverRedisConfig;
};
