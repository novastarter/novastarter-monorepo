import { processId } from '@novastarter/utils/node';
import { type BusDriver, BusDriverRedis } from '../../../bus/index.js';
import type { Lock } from '../../../kv/types.js';
import type { CacheDriver } from '../../driver.js';
import { CacheDriverLocal, type CacheDriverLocalConfig } from './local.js';
import { CacheDriverRedis, type CacheDriverRedisConfig } from './redis.js';

/**
 * Options of {@link CacheDriverMulti}, the `multi` driver: a local L1 in front of a Redis L2.
 */
export type CacheDriverMultiConfig = {
	/**
	 * Configuration of the L1 (in-memory) cache.
	 */
	local: CacheDriverLocalConfig;

	/**
	 * Configuration of the L2 (Redis) cache; its connection and namespace are also used for the invalidation bus.
	 */
	redis: CacheDriverRedisConfig;
};

/**
 * Bus channel on which multi-stage caches tell each other to drop local entries.
 */
export const CACHE_CHANNEL_KEY = 'multi-cache';

/**
 * Invalidation message a {@link CacheDriverMulti} publishes after every write.
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
 * local lock would not protect against other processes. The bus subscribes on a connection of its own, which
 * `close()` quits; the L2 connection belongs to the caller.
 *
 * @example
 * ```ts
 * const cache = new CacheDriverMulti({
 * 	local: { maxKeys: 500 },
 * 	redis: {
 * 		redis: new Redis(),
 * 		namespace: 'app',
 * 	},
 * });
 * ```
 */
export class CacheDriverMulti implements CacheDriver {
	/**
	 * Id of this process, stamped on outgoing invalidations.
	 *
	 * @internal
	 */
	private readonly processId: string = processId();

	/**
	 * L1: per-process memory.
	 *
	 * @internal
	 */
	private readonly local: CacheDriverLocal;

	/**
	 * L2: shared Redis.
	 *
	 * @internal
	 */
	private readonly redis: CacheDriverRedis;

	/**
	 * Pub/sub used to invalidate the L1 of other processes.
	 *
	 * @internal
	 */
	private readonly bus: BusDriver;

	/**
	 * The subscription to the invalidations of other processes, settled once Redis confirmed it; `undefined` while
	 * none is under way, which is where a failed one puts it back.
	 *
	 * Every write awaits it before publishing: a process that never managed to subscribe would keep serving a stale
	 * L1 for good, so a write is where the failure comes out rather than in an unhandled rejection at construction —
	 * and where the subscription is tried again, so a Redis that was unreachable at start does not leave the cache
	 * dead for the rest of the process.
	 *
	 * @internal
	 */
	private subscribed: Promise<void> | undefined;

	/**
	 * Create both cache levels and subscribe to invalidations from other processes.
	 *
	 * @param config - Options of both levels.
	 */
	constructor(config: CacheDriverMultiConfig) {
		// 1. Build the two levels and a bus over the same Redis connection and namespace as L2
		this.local = new CacheDriverLocal(config.local);
		this.redis = new CacheDriverRedis(config.redis);
		this.bus = new BusDriverRedis({ redis: config.redis.redis, namespace: config.redis.namespace });

		// 2. Subscribe right away, so invalidations are received before the first write; the no-op `catch` only marks a
		//    failure as observed here, so it is reported where a write awaits it and not as an unhandled rejection
		//    nobody can act on
		this.subscribe().catch(() => {});
	}

	/**
	 * Start the subscription to other processes' invalidations, or answer with the one under way.
	 *
	 * A failed subscription is forgotten, so the next call starts a fresh one: the failure has been reported to the
	 * caller that awaited it, and the following write is the natural moment to try again.
	 *
	 * @returns Once Redis confirmed the subscription.
	 * @internal
	 */
	private subscribe(): Promise<void> {
		// 1. Reuse the subscription under way or already confirmed; only a missing one — never started, or failed and
		//    forgotten — starts a new `SUBSCRIBE`
		if (this.subscribed === undefined) {
			// 2. Wrap the handler in a lambda, so `this` still points at the cache when the bus calls it; a failure
			//    clears the field before it is passed on, so the caller sees the error and the next call retries
			this.subscribed = this.bus
				.subscribe<CacheMultiMessageClear>(CACHE_CHANNEL_KEY, (payload) => this.onMessageClear(payload))
				.catch((error: unknown) => {
					this.subscribed = undefined;

					throw error;
				});
		}

		return this.subscribed;
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
		// 1. A process that could not subscribe must not write as if it took part in the invalidation: the write
		//    subscribes again when the earlier attempt failed, and throws when this one fails too
		await this.subscribe();

		// 2. Stamp the message with this process's id, so the sender can skip it when it comes back
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
	 * Quit the bus's subscriber connection; the process is shutting down.
	 *
	 * The only connection of the driver's own: L2 runs on the connection the caller handed in and is closed there, L1
	 * holds nothing.
	 *
	 * @returns Once the server acknowledged the quit.
	 */
	async close(): Promise<void> {
		// 1. The bus duplicated the L2 connection for subscribing; that duplicate is what would keep the process alive
		await this.bus.close?.();
	}

	/**
	 * Apply an invalidation received over the bus to L1.
	 *
	 * @param payload - Message published by a {@link CacheDriverMulti} in some process.
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
