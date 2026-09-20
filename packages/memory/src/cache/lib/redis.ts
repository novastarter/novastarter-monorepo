import { type Kv, KvRedis } from '../../kv/index.js';
import type { Lock } from '../../kv/types/lock.js';
import type { CacheRedisOptions } from '../index.js';
import type { Cache } from '../types/class.js';

/**
 * Redis-backed cache shared between processes, a thin wrapper over `KvRedis`.
 *
 * @example
 * ```ts
 * const cache = new CacheRedis({ redis: new Redis(), namespace: 'app', ttl: 60_000 });
 *
 * await cache.set('my-key', 'my-value');
 * ```
 */
export class CacheRedis implements Cache {
	/**
	 * Underlying key-value store doing the actual work.
	 *
	 * @internal
	 */
	private store: Kv;

	/**
	 * Create the cache on top of an existing Redis connection.
	 *
	 * @param config - Redis configuration.
	 */
	constructor(config: CacheRedisOptions) {
		// 1. The cache reuses the Kv store, so serialization, compression and locking live in one place
		this.store = new KvRedis(config);
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
