import { type Kv, KvDriverLocal } from '../../kv/index.js';
import type { Lock } from '../../kv/types/lock.js';
import type { Cache } from '../types/class.js';
import type { CacheDriverLocalConfig } from '../types/config.js';

/**
 * In-memory cache for a single process, a thin wrapper over `KvDriverLocal`.
 *
 * @example
 * ```ts
 * const cache = new CacheDriverLocal({ maxKeys: 500 });
 *
 * await cache.set('my-key', 'my-value');
 * ```
 */
export class CacheDriverLocal implements Cache {
	/**
	 * Underlying key-value store doing the actual work.
	 *
	 * @internal
	 */
	private store: Kv;

	/**
	 * Create the cache with optional size and time limits.
	 *
	 * @param config - Local configuration.
	 */
	constructor(config: CacheDriverLocalConfig) {
		// 1. The cache reuses the Kv store instead of holding its own map, so both share one implementation
		this.store = new KvDriverLocal(config);
	}

	/**
	 * Get the cached value by key.
	 *
	 * @typeParam T - Type the caller expects the value to be.
	 * @param key - Key to retrieve.
	 * @returns Cached value, or `undefined` when the key does not exist.
	 */
	async get<T = unknown>(key: string): Promise<T | undefined> {
		// 1. Delegate; `await` normalises the synchronous local answer to the async cache API
		return await this.store.get<T>(key);
	}

	/**
	 * Save the given value to the cache.
	 *
	 * @param key - Key to save.
	 * @param value - Value to save. Can be any JavaScript primitive, plain object or array.
	 */
	async set(key: string, value: unknown): Promise<void> {
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
		await this.store.delete(key);
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
	 * Remove all keys from the cache.
	 */
	async clear(): Promise<void> {
		// 1. Delegate to the store
		await this.store.clear();
	}

	/**
	 * Acquire a lock on the given key; a no-op handle for the local backend.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock.
	 */
	async acquireLock(key: string): Promise<Lock> {
		// 1. Delegate to the store
		return await this.store.acquireLock(key);
	}

	/**
	 * Run a callback while holding a lock on the given key.
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
