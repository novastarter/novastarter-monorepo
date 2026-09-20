import type { Redis } from 'ioredis';

/**
 * ioredis client extended with the Lua commands `KvRedis` defines on it.
 *
 * `defineCommand` adds the methods at runtime; this interface makes them visible to the type-checker.
 */
export interface ExtendedRedis extends Redis {
	/**
	 * Store `value` only when it is larger than the current value of `key`.
	 *
	 * @param key - Namespaced key.
	 * @param value - Candidate value.
	 * @returns `1` when the value was stored, `0` otherwise.
	 */
	setMax(key: string, value: number): Promise<number>;

	/**
	 * Delete `key` only when it still holds `value`, the check-and-delete a lock release needs.
	 *
	 * @param key - Namespaced key.
	 * @param value - Expected current value.
	 * @returns Number of keys deleted.
	 */
	release(key: string, value: string): Promise<number>;
}

/**
 * Options of the in-memory store, the `local` driver.
 */
export interface KvLocalOptions {
	/**
	 * Maximum number of keys in the store; the least recently used key is evicted beyond it.
	 */
	maxKeys?: number;

	/**
	 * Time-to-live: keys expire after this many milliseconds.
	 */
	ttl?: number;
}

/**
 * Options of the Redis-backed store, the `redis` driver.
 */
export interface KvRedisOptions {
	/**
	 * Prefix for every key, so several stores can share one Redis instance.
	 */
	namespace: string;

	/**
	 * Enable gzip compression of stored values.
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
	 * How long an acquired lock is held, in milliseconds.
	 */
	lockTimeout?: number;

	/**
	 * Existing or new Redis connection to use with this store.
	 */
	redis: Redis | ExtendedRedis;

	/**
	 * Time-to-live: keys expire after this many milliseconds.
	 */
	ttl?: number;
}
