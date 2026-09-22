import type { Redis } from 'ioredis';
import { type KvDriver, KvDriverRedis } from '../../../kv/index.js';
import type { Lock } from '../../../kv/types.js';
import type { CacheDriver } from '../../driver.js';

/**
 * Options of {@link CacheDriverRedis}, the `redis` driver: those of `KvDriverRedis`, which does the work.
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
	 * How long an acquired lock is held, in milliseconds, and about how long `acquireLock` waits for a busy one
	 * before giving up. At least 200 and at most what a timer can hold; anything else is refused at construction.
	 *
	 * @defaultValue 5000
	 */
	lockTimeout?: number | undefined;

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
	 * @throws RangeError when `lockTimeout` is under 200 ms or above what a timer can hold, or the client sits on a
	 * database above 15, where Redlock cannot lock.
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
		// 1. The store reads the raw bytes, gunzips what was compressed and parses the JSON; the cache adds no step, so
		//    a value a Kv wrote under the same namespace reads the same
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
		// 1. The store namespaces the key, gzips a value above `compressionMinSize` and sets the `PX` expiry in the same
		//    round trip as the write
		return await this.store.set(key, value);
	}

	/**
	 * Remove the given key from the cache.
	 *
	 * @param key - Key to remove.
	 */
	async delete(key: string): Promise<void> {
		// 1. The store unlinks the key off the Redis main thread; this cache holds no local copy that would need
		//    dropping alongside
		return await this.store.delete(key);
	}

	/**
	 * Check whether a key exists in the cache.
	 *
	 * @param key - Key to check.
	 * @returns `true` when the key exists.
	 */
	async has(key: string): Promise<boolean> {
		// 1. An `EXISTS` round trip is the only truth about a key shared between processes; there is no local copy to
		//    answer from
		return await this.store.has(key);
	}

	/**
	 * Remove all keys in this cache's namespace.
	 */
	async clear(): Promise<void> {
		// 1. The store scans its namespace and unlinks in one pipeline; held locks live under `<namespace>-locks` and
		//    survive it
		await this.store.clear();
	}

	/**
	 * Acquire a distributed lock on the given key.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock.
	 * @throws Error when the lock is still held once the retry budget — about `lockTimeout` — is spent.
	 */
	async acquireLock(key: string): Promise<Lock> {
		// 1. The lock is the store's Redlock lock: visible to every process on the server, held for `lockTimeout` and
		//    extendable, which a lock in this process's memory could not offer
		return await this.store.acquireLock(key);
	}

	/**
	 * Run a callback while holding a distributed lock on the given key.
	 *
	 * @typeParam T - Value the callback resolves to.
	 * @param key - Key to lock.
	 * @param callback - Work to run under the lock.
	 * @returns Whatever the callback resolves to.
	 * @throws Error when the lock is still held once the retry budget — about `lockTimeout` — is spent; whatever the
	 * callback throws.
	 */
	async usingLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
		// 1. The store's Redlock `using` renews the lock while the callback runs and releases it afterwards, so a long
		//    callback keeps its exclusivity without the cache tracking the expiry
		return await this.store.usingLock(key, callback);
	}
}
