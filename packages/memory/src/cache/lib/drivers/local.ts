import { type KvDriver, KvDriverLocal } from '../../../kv/index.js';
import type { Lock } from '../../../kv/types.js';
import type { CacheDriver } from '../../driver.js';

/**
 * Options of {@link CacheDriverLocal}, the `local` driver: those of `KvDriverLocal`, which does the work.
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

	/**
	 * How long `acquireLock` waits for a busy key before giving up, in milliseconds. From `0` to what a timer can hold
	 * (`MAX_TIMER_DELAY` of `@novastarter/utils`); anything else is refused at construction.
	 *
	 * @defaultValue 5000
	 */
	lockTimeout?: number | undefined;
};

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
export class CacheDriverLocal implements CacheDriver {
	/**
	 * Underlying key-value store doing the actual work.
	 *
	 * @internal
	 */
	private readonly store: KvDriver;

	/**
	 * Create the cache with optional size and time limits.
	 *
	 * @param config - Local configuration.
	 * @throws RangeError when `lockTimeout` is not between `0` and what a timer can hold.
	 */
	constructor(config: CacheDriverLocalConfig = {}) {
		// The cache reuses the Kv store instead of holding its own map, so both share one implementation
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
		// `await` normalises the synchronous local answer to the async cache API
		return await this.store.get<T>(key);
	}

	/**
	 * Save the given value to the cache.
	 *
	 * @param key - Key to save.
	 * @param value - Value to save. Can be any JavaScript primitive, plain object or array.
	 */
	async set(key: string, value: unknown): Promise<void> {
		// The store serializes the value to bytes, so the cache hands the object over as is and no caller can change a
		// cached entry through the reference it kept
		return await this.store.set(key, value);
	}

	/**
	 * Remove the given key from the cache.
	 *
	 * @param key - Key to remove.
	 */
	async delete(key: string): Promise<void> {
		// Nothing to add over the store: a single process holds no second copy of the key that would need dropping
		await this.store.delete(key);
	}

	/**
	 * Check whether a key exists in the cache.
	 *
	 * @param key - Key to check.
	 * @returns `true` when the key exists.
	 */
	async has(key: string): Promise<boolean> {
		// The store's probe does not refresh recency, so asking does not keep a key alive in the LRU
		return await this.store.has(key);
	}

	/**
	 * Remove all keys from the cache.
	 */
	async clear(): Promise<void> {
		// The store owns the LRU, so emptying it is the whole operation; no other process holds a copy to tell
		await this.store.clear();
	}

	/**
	 * Acquire a lock on the given key, waiting for the holders of this process before it.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock.
	 * @throws Error when the key is still held once `lockTimeout` passed.
	 */
	async acquireLock(key: string): Promise<Lock> {
		// The lock is the store's in-process one: one holder per key of this process, the others waiting their turn for
		// `lockTimeout`; there is no other process a cache in memory would have to protect against
		return await this.store.acquireLock(key);
	}

	/**
	 * Run a callback while holding a lock on the given key.
	 *
	 * @typeParam T - Value the callback resolves to.
	 * @param key - Key to lock.
	 * @param callback - Work to run under the lock.
	 * @returns Whatever the callback resolves to.
	 * @throws Error when the key is still held once `lockTimeout` passed; whatever the callback throws.
	 */
	async usingLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
		// The store takes, holds and releases the lock around the callback, throwing or not, so the cache needs no
		// try/finally of its own
		return await this.store.usingLock(key, callback);
	}
}
