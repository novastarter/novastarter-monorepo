import type { Redis } from 'ioredis';
import { type KvDriver, KvDriverRedis } from '../../../kv/index.js';
import type { Lock } from '../../../kv/types.js';
import type { CacheDriver } from '../../driver.js';

/**
 * Options of {@link CacheDriverRedis}, the `redis` driver.
 */
export type CacheDriverRedisConfig = {
	/**
	 * Prefix for every key, so several caches can share one Redis instance.
	 */
	namespace: string;

	/**
	 * Enable gzip compression of cached values.
	 *
	 * @defaultValue true
	 */
	compression?: boolean | undefined;

	/**
	 * Minimum byte size of a value before it is compressed.
	 *
	 * There is a trade-off between size and the time spent gzipping; below roughly 1 kB the savings do not pay for
	 * the CPU time.
	 *
	 * @defaultValue 1000
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
 * Redis-backed cache shared between processes, a thin wrapper over `KvDriverRedis`.
 *
 * @example
 * ```ts
 * const cache = new CacheDriverRedis({
 * 	redis: new Redis(),
 * 	namespace: 'app',
 * 	ttl: 60_000,
 * });
 *
 * await cache.set('my-key', 'my-value');
 * ```
 */
export class CacheDriverRedis implements CacheDriver {
	/**
	 * Underlying key-value store doing the actual work.
	 *
	 * @internal
	 */
	private readonly store: KvDriver;

	/**
	 * Create the cache on top of an existing Redis connection.
	 *
	 * @param config - Redis configuration.
	 */
	constructor(config: CacheDriverRedisConfig) {
		// 1. The cache reuses the Kv store, so serialization, compression and locking live in one place
		this.store = new KvDriverRedis(config);
	}

	/**
	 * Get the cached value by key.
	 *
	 * @typeParam T - Type the caller expects the value to be.
	 * @param key - Key to retrieve.
	 * @returns Cached value, or `undefined` when the key does not exist.
	 */
	async get<T = unknown>(key: string): Promise<T | undefined> {
		// 1. Delegate to the store
		return await this.store.get<T>(key);
	}

	/**
	 * Save the given value to the cache.
	 *
	 * @typeParam T - Type of the value.
	 * @param key - Key to save.
	 * @param value - Value to save. Can be any JavaScript primitive, plain object or array.
	 */
	async set<T = unknown>(key: string, value: T): Promise<void> {
		// 1. Delegate to the store
		return await this.store.set(key, value);
	}

	/**
	 * Remove the given key from the cache.
	 *
	 * @param key - Key to remove.
	 */
	async delete(key: string): Promise<void> {
		// 1. Delegate to the store
		return await this.store.delete(key);
	}

	/**
	 * Check whether a key exists in the cache.
	 *
	 * @param key - Key to check.
	 * @returns `true` when the key exists.
	 */
	async has(key: string): Promise<boolean> {
		// 1. Delegate to the store
		return await this.store.has(key);
	}

	/**
	 * Remove all keys in this cache's namespace.
	 */
	async clear(): Promise<void> {
		// 1. Delegate to the store
		await this.store.clear();
	}

	/**
	 * Acquire a distributed lock on the given key.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock.
	 */
	async acquireLock(key: string): Promise<Lock> {
		// 1. Delegate to the store
		return await this.store.acquireLock(key);
	}

	/**
	 * Run a callback while holding a distributed lock on the given key.
	 *
	 * @typeParam T - Value the callback resolves to.
	 * @param key - Key to lock.
	 * @param callback - Work to run under the lock.
	 * @returns Whatever the callback resolves to.
	 */
	async usingLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
		// 1. Delegate to the store
		return await this.store.usingLock(key, callback);
	}
}
