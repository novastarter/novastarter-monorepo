import type { Lock, MaybePromise } from './types.js';

/**
 * Key-value store shared by the local and Redis backends.
 */
export interface Kv {
	/**
	 * Get the stored value by key.
	 *
	 * @typeParam T - Type the caller expects the value to be.
	 * @param key - Key to retrieve from the store.
	 * @returns Stored value, or `undefined` when the key does not exist.
	 */
	get<T = unknown>(key: string): MaybePromise<T | undefined>;

	/**
	 * Save the given value to the store.
	 *
	 * @typeParam T - Type of the value.
	 * @param key - Key to save in the store.
	 * @param value - Value to save. Can be any JavaScript primitive, plain object or array.
	 * @returns Resolves once the value is stored.
	 */
	set<T = unknown>(key: string, value: T): MaybePromise<void>;

	/**
	 * Remove the given key from the store.
	 *
	 * @param key - Key to remove from the store.
	 * @returns Resolves once the key is removed.
	 */
	delete(key: string): MaybePromise<void>;

	/**
	 * Check whether a key exists in the store.
	 *
	 * @param key - Key to check.
	 * @returns `true` when the key exists.
	 */
	has(key: string): MaybePromise<boolean>;

	/**
	 * Increment the stored number by the given amount.
	 *
	 * @param key - Key to increment in the store; a missing key counts as `0`.
	 * @param amount - Amount to add. Defaults to `1`.
	 * @returns Updated value.
	 */
	increment(key: string, amount?: number): MaybePromise<number>;

	/**
	 * Save the given number only when it is larger than the stored one.
	 *
	 * @param key - Key to save in the store.
	 * @param value - Number to save when it beats the current value.
	 * @returns `true` when the value was saved.
	 */
	setMax(key: string, value: number): MaybePromise<boolean>;

	/**
	 * Acquire a lock on the given key, waiting for it to become free.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock.
	 */
	acquireLock(key: string): MaybePromise<Lock>;

	/**
	 * Run a callback while holding a lock on the given key, releasing it afterwards.
	 *
	 * @typeParam T - Value the callback resolves to.
	 * @param key - Key to lock.
	 * @param callback - Work to run under the lock.
	 * @returns Whatever the callback resolves to.
	 */
	usingLock<T>(key: string, callback: () => Promise<T>): MaybePromise<T>;

	/**
	 * Remove all keys from the store.
	 *
	 * @returns Resolves once the store is empty.
	 */
	clear(): MaybePromise<void>;

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
