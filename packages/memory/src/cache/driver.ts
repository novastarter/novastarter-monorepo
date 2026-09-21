import type { Lock } from '../kv/types.js';

/**
 * Cache shared by the local, Redis and multi-stage backends.
 *
 * A cache is a `KvDriver` without the numeric helpers and with an always-asynchronous API, so callers can swap backends
 * without changing their code.
 */
export interface CacheDriver {
	/**
	 * Get the cached value by key.
	 *
	 * @typeParam T - Type the caller expects the value to be.
	 * @param key - Key to retrieve from the cache.
	 * @returns Cached value, or `undefined` when the key does not exist.
	 */
	get<T = unknown>(key: string): Promise<T | undefined>;

	/**
	 * Save the given value to the cache.
	 *
	 * @typeParam T - Type of the value.
	 * @param key - Key to save in the cache.
	 * @param value - Value to save. Can be any JavaScript primitive, plain object or array.
	 * @returns Resolves once the value is cached.
	 */
	set<T = unknown>(key: string, value: T): Promise<void>;

	/**
	 * Remove the given key from the cache.
	 *
	 * @param key - Key to remove from the cache.
	 * @returns Resolves once the key is removed.
	 */
	delete(key: string): Promise<void>;

	/**
	 * Check whether a key exists in the cache.
	 *
	 * @param key - Key to check.
	 * @returns `true` when the key exists.
	 */
	has(key: string): Promise<boolean>;

	/**
	 * Remove all keys from the cache.
	 *
	 * @returns Resolves once the cache is empty.
	 */
	clear(): Promise<void>;

	/**
	 * Acquire a lock on the given key, waiting for it to become free.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock.
	 */
	acquireLock(key: string): Promise<Lock>;

	/**
	 * Run a callback while holding a lock on the given key, releasing it afterwards.
	 *
	 * @typeParam T - Value the callback resolves to.
	 * @param key - Key to lock.
	 * @param callback - Work to run under the lock.
	 * @returns Whatever the callback resolves to.
	 */
	usingLock<T>(key: string, callback: () => Promise<T>): Promise<T>;

	/**
	 * Release what the driver holds — a connection of its own, timers — so the process can exit.
	 *
	 * Optional: a driver in memory or on a connection it was handed has nothing to release. The manager calls it at
	 * shutdown.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}
