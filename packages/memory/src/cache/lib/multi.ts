import { processId } from '@novastarter/utils/node';
import { type Bus, BusRedis } from '../../bus/index.js';
import type { Lock } from '../../kv/types/lock.js';
import type { Cache } from '../types/class.js';
import type { CacheMultiOptions } from '../types/config.js';
import { CacheLocal } from './local.js';
import { CacheRedis } from './redis.js';

/**
 * Bus channel on which multi-stage caches tell each other to drop local entries.
 */
export const CACHE_CHANNEL_KEY = 'multi-cache';

/**
 * Invalidation message a {@link CacheMulti} publishes after every write.
 */
export type CacheMultiMessageClear = {
	/** Only one message type exists so far. */
	type: 'clear';

	/** Id of the process the message came from, so the sender can ignore its own message. */
	origin: string;

	/**
	 * Key to drop from local memory.
	 *
	 * Every local key is dropped when left undefined.
	 */
	key?: string;
};

/**
 * Two-level cache: local memory (L1) in front of Redis (L2), kept coherent across processes over the bus.
 *
 * Reads try L1 first and fall back to L2. Writes go to both levels and then publish an invalidation, so every other
 * process drops its stale L1 copy and re-reads from Redis on its next access. Locks always go through Redis, since a
 * local lock would not protect against other processes.
 *
 * @example
 * ```ts
 * const cache = new CacheMulti({
 * 	local: { maxKeys: 500 },
 * 	redis: {
 * 	redis: new Redis(),
 * 	namespace: 'app',
 * },
 * });
 * ```
 */
export class CacheMulti implements Cache {
	/** Id of this process, stamped on outgoing invalidations. */
	processId: string = processId();

	/** L1: per-process memory. */
	local: CacheLocal;

	/** L2: shared Redis. */
	redis: CacheRedis;

	/** Pub/sub used to invalidate the L1 of other processes. */
	bus: Bus;

	/**
	 * Create both cache levels and subscribe to invalidations from other processes.
	 *
	 * @param config - Options of both levels.
	 */
	constructor(config: CacheMultiOptions) {
		// 1. Build the two levels and a bus over the same Redis connection and namespace as L2
		this.local = new CacheLocal(config.local);
		this.redis = new CacheRedis(config.redis);
		this.bus = new BusRedis({ redis: config.redis.redis, namespace: config.redis.namespace });

		// 2. Wrap the handler in a lambda, so `this` still points at the cache when the bus calls it
		this.bus.subscribe<CacheMultiMessageClear>(CACHE_CHANNEL_KEY, (payload) => this.onMessageClear(payload));
	}

	/**
	 * Get the cached value by key, from L1 when present and from L2 otherwise.
	 *
	 * @typeParam T - Type the caller expects the value to be.
	 * @param key - Key to retrieve.
	 * @returns Cached value, or `undefined` when the key does not exist in either level.
	 */
	async get<T = unknown>(key: string): Promise<T | undefined> {
		// 1. L1 is a memory lookup, so try it before paying for a Redis round trip
		const local = await this.local.get<T>(key);

		if (local !== undefined) {
			return local;
		}

		// 2. Fall back to L2; the value is not promoted into L1 here, only writes populate L1
		return await this.redis.get<T>(key);
	}

	/**
	 * Save the given value to both levels and invalidate the key in other processes.
	 *
	 * @param key - Key to save.
	 * @param value - Value to save. Can be any JavaScript primitive, plain object or array.
	 */
	async set(key: string, value: unknown): Promise<void> {
		// 1. Write both levels in parallel; they are independent
		await Promise.all([this.local.set(key, value), this.redis.set(key, value)]);

		// 2. Tell other processes their L1 copy of this key is stale
		await this.clearOthers(key);
	}

	/**
	 * Remove the given key from both levels and from the L1 of other processes.
	 *
	 * @param key - Key to remove.
	 */
	async delete(key: string): Promise<void> {
		// 1. Delete from both levels in parallel
		await Promise.all([this.local.delete(key), this.redis.delete(key)]);

		// 2. Other processes drop the key from their L1 as well
		await this.clearOthers(key);
	}

	/**
	 * Check whether a key exists in the cache.
	 *
	 * @param key - Key to check.
	 * @returns `true` when the key exists in L2.
	 */
	async has(key: string): Promise<boolean> {
		// 1. L2 is the source of truth: a key can be missing from this process's L1 yet cached elsewhere
		return await this.redis.has(key);
	}

	/**
	 * Publish an invalidation for a key, or for everything when no key is given.
	 *
	 * @param key - Key other processes should drop; all keys when omitted.
	 * @internal
	 */
	private async clearOthers(key?: string) {
		// 1. Stamp the message with this process's id, so the sender can skip it when it comes back
		await this.bus.publish(CACHE_CHANNEL_KEY, {
			type: 'clear',
			key: key,
			origin: this.processId,
		});
	}

	/**
	 * Remove all keys from both levels and from the L1 of other processes.
	 */
	async clear(): Promise<void> {
		// 1. Clear both levels in parallel
		await Promise.all([this.local.clear(), this.redis.clear()]);

		// 2. A message without a key means "drop everything"
		await this.clearOthers();
	}

	/**
	 * Acquire a distributed lock on the given key through L2.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock.
	 */
	async acquireLock(key: string): Promise<Lock> {
		// 1. Only the Redis lock is visible to other processes
		return await this.redis.acquireLock(key);
	}

	/**
	 * Run a callback while holding a distributed lock on the given key through L2.
	 *
	 * @typeParam T - Value the callback resolves to.
	 * @param key - Key to lock.
	 * @param callback - Work to run under the lock.
	 * @returns Whatever the callback resolves to.
	 */
	async usingLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
		// 1. Only the Redis lock is visible to other processes
		return await this.redis.usingLock(key, callback);
	}

	/**
	 * Apply an invalidation received over the bus to L1.
	 *
	 * @param payload - Message published by a {@link CacheMulti} in some process.
	 * @internal
	 */
	private async onMessageClear(payload: CacheMultiMessageClear) {
		// 1. Skip messages this process sent itself: `set` and `delete` already updated L1 before publishing, so
		//    dropping the key again would only throw away fresh data
		if (payload.origin === this.processId) return;

		// 2. Drop the one key, or everything when the message carries no key
		if (payload.key !== undefined) {
			await this.local.delete(payload.key);
		} else {
			await this.local.clear();
		}
	}
}
