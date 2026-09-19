import type { Redis } from 'ioredis';

/**
 * Options every cache configuration shares.
 */
export interface CacheConfigAbstract {
	/**
	 * Where the data is stored.
	 *
	 * `local` - Local memory
	 * `redis` - Redis instance
	 * `multi` - Multi-stage cache: in-memory as L1, Redis as L2
	 */
	type: 'local' | 'redis' | 'multi';
}

/**
 * Configuration of the in-memory cache.
 */
export interface CacheConfigLocal extends CacheConfigAbstract {
	type: 'local';

	/**
	 * Maximum number of keys in the cache; the least recently used key is evicted beyond it.
	 */
	maxKeys?: number;

	/**
	 * Time-to-live: keys expire after this many milliseconds.
	 */
	ttl?: number;
}

/**
 * Configuration of the Redis-backed cache.
 */
export interface CacheConfigRedis extends CacheConfigAbstract {
	type: 'redis';

	/**
	 * Prefix for every key, so several caches can share one Redis instance.
	 */
	namespace: string;

	/**
	 * Enable gzip compression of cached values.
	 *
	 * @default true
	 */
	compression?: boolean;

	/**
	 * Minimum byte size of a value before it is compressed.
	 *
	 * There is a trade-off between size and the time spent gzipping; below roughly 1 kB the savings do not pay for
	 * the CPU time.
	 *
	 * @default 1000
	 */
	compressionMinSize?: number;

	/**
	 * Time-to-live: keys expire after this many milliseconds.
	 */
	ttl?: number;

	/**
	 * Existing or new Redis connection to use with this cache.
	 */
	redis: Redis;
}

/**
 * Configuration of the multi-stage cache: a local L1 in front of a Redis L2.
 */
export interface CacheConfigMulti extends CacheConfigAbstract {
	type: 'multi';

	/**
	 * Configuration of the L1 (in-memory) cache.
	 */
	local: Omit<CacheConfigLocal, 'type'>;

	/**
	 * Configuration of the L2 (Redis) cache; its connection and namespace are also used for the invalidation bus.
	 */
	redis: Omit<CacheConfigRedis, 'type'>;
}

/**
 * Union of the supported cache configurations, discriminated by `type`.
 */
export type CacheConfig = CacheConfigLocal | CacheConfigRedis | CacheConfigMulti;
