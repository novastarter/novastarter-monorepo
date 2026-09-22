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
	 *
	 * Its `ttl` defaults to the L2 `ttl` and may not exceed it: a key L2 already let expire must not go on being
	 * served from the memory of the process that wrote it.
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
 * process drops its stale L1 copy and re-reads from Redis on its next access; an invalidation that lands while this
 * process's own write is still in flight keeps that write out of L1, so a concurrent writer elsewhere cannot leave a
 * stale copy behind that nothing invalidates any more. L1 expires no later than L2, so a key Redis let go is not
 * served from memory either. Locks always go through Redis, since a local lock would not protect against other
 * processes. The bus subscribes on a connection of its own, which `close()` quits; the L2 connection belongs to the
 * caller.
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
	 * Every write awaits it before touching either level: a process that never managed to subscribe would keep
	 * serving a stale L1 for good, so a write is where the failure comes out rather than in an unhandled rejection at
	 * construction — before the key lands in L1, where it would sit unseen by the invalidations the process cannot
	 * receive — and where the subscription is tried again, so a Redis that was unreachable at start does not leave
	 * the cache dead for the rest of the process.
	 *
	 * @internal
	 */
	private subscribed: Promise<void> | undefined;

	/**
	 * Whether `close()` ran: the bus receives no invalidations any more, so a write would put a key into L1 that no
	 * `clear` message can reach.
	 *
	 * @internal
	 */
	private closed = false;

	/**
	 * Per key with a write to L2 under way, how many such writes there are and whether another process invalidated
	 * the key meanwhile.
	 *
	 * The invalidation of a concurrent writer elsewhere travels on the subscriber connection and may be handled before
	 * the reply to this process's own L2 write arrives on the command connection. Dropping the key from L1 at that
	 * moment removes nothing — the write has not reached L1 yet — and the write would then land in L1 as a copy L2
	 * no longer holds, with no further invalidation coming. An entry here marks such a write as invalidated, so it
	 * skips L1; the last write on a key to settle removes the entry, so the map never grows with keys nobody writes.
	 *
	 * @internal
	 */
	private readonly writing: Map<string, { count: number; invalidated: boolean }> = new Map();

	/**
	 * Create both cache levels and subscribe to invalidations from other processes.
	 *
	 * @param config - Options of both levels.
	 * @throws RangeError when `local.ttl` exceeds `redis.ttl`, when `redis.lockTimeout` is under 200 ms or above what
	 * a timer can hold, or when the client sits on a database above 15, where Redlock cannot lock.
	 */
	constructor(config: CacheDriverMultiConfig) {
		// 1. L1 expires no later than L2: without a ttl of its own it takes the L2 one, and a longer one is refused,
		//    since L2 expiry never reaches L1 — only writes publish invalidations — and the writing process would keep
		//    serving from memory a key every other process already lost
		const ttl = config.local.ttl ?? config.redis.ttl;

		if (config.redis.ttl !== undefined && ttl !== undefined && ttl > config.redis.ttl) {
			throw new RangeError(
				`CacheDriverMulti: "local.ttl" (${ttl} ms) must not exceed "redis.ttl" (${config.redis.ttl} ms)`,
			);
		}

		// 2. Build the two levels and a bus over the same Redis connection and namespace as L2
		this.local = new CacheDriverLocal(ttl === undefined ? config.local : { ...config.local, ttl });
		this.redis = new CacheDriverRedis(config.redis);
		this.bus = new BusDriverRedis({ redis: config.redis.redis, namespace: config.redis.namespace });

		// 3. Subscribe right away, so invalidations are received before the first write; the no-op `catch` only marks a
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
		// 1. A closed cache subscribes to nothing: its bus is gone, so a write after `close()` is refused rather than
		//    let into an L1 nobody invalidates
		if (this.closed) {
			return Promise.reject(new Error('The multi cache is closed; it receives no invalidations any more'));
		}

		// 2. Reuse the subscription under way or already confirmed; only a missing one — never started, or failed and
		//    forgotten — starts a new `SUBSCRIBE`
		if (this.subscribed === undefined) {
			// 3. Wrap the handler in a lambda, so `this` still points at the cache when the bus calls it; a failure
			//    clears the field before it is passed on, so the caller sees the error and the next call retries
			this.subscribed = this.bus
				.subscribe<CacheMultiMessageClear>(CACHE_CHANNEL_KEY, (payload) => this.onMessageClear(payload))
				.catch((error: unknown) => {
					// 1. Forgotten, so the next `subscribe()` starts over; the error still reaches the caller awaiting this one
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
	 * @throws Error when the cache was closed, or the subscription to other processes' invalidations cannot be made:
	 * a write this process could not be told to invalidate is refused.
	 */
	async set(key: string, value: unknown): Promise<void> {
		// 1. Subscribed first: a key written into L1 by a process that receives no invalidations would go stale unseen
		await this.subscribe();

		// 2. Counted as under way before L2 takes the value, so an invalidation from another process that is handled
		//    while the reply is still in flight is not lost on an L1 that does not hold the key yet
		const writing = this.writing.get(key) ?? { count: 0, invalidated: false };
		writing.count += 1;
		this.writing.set(key, writing);

		// 3. L2 first, L1 only once L2 took the value: written the other way round, a Redis that refuses the write
		//    (read-only replica, out of memory, timeout) would leave this process serving a value from L1 that L2 and
		//    every other process lack, with no invalidation ever published for it. Settled either way, so a refused
		//    write does not leave the key counted as under way for good
		let invalidated: boolean;

		try {
			await this.redis.set(key, value);
		} finally {
			invalidated = writing.invalidated;
			writing.count -= 1;

			if (writing.count === 0) {
				this.writing.delete(key);
			}
		}

		// 4. Into L1 only when no other process wrote the key meanwhile: their invalidation already dropped whatever L1
		//    held, and this value may be older than what L2 holds now, so the next read fetches it from L2 instead
		if (!invalidated) {
			await this.local.set(key, value);
		}

		// 5. Tell other processes their L1 copy of this key is stale
		await this.clearOthers(key);
	}

	/**
	 * Remove the given key from both levels and from the L1 of other processes.
	 *
	 * @param key - Key to remove.
	 * @throws Error when the cache was closed, or the subscription to other processes' invalidations cannot be made:
	 * a write this process could not be told to invalidate is refused.
	 */
	async delete(key: string): Promise<void> {
		// 1. Subscribed first, for the same reason as in `set`
		await this.subscribe();

		// 2. L2 first, then L1, in the same order as `set`: a failed L2 delete leaves L1 as it was, which is a copy of
		//    what L2 still holds
		await this.redis.delete(key);
		await this.local.delete(key);

		// 3. Other processes drop the key from their L1 as well
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
		// 1. Stamp the message with this process's id, so the sender can skip it when it comes back; the caller made
		//    sure of the subscription before writing
		await this.bus.publish(CACHE_CHANNEL_KEY, {
			type: 'clear',
			key: key,
			origin: this.processId,
		});
	}

	/**
	 * Remove all keys from both levels and from the L1 of other processes.
	 * @throws Error when the cache was closed, or the subscription to other processes' invalidations cannot be made:
	 * a write this process could not be told to invalidate is refused.
	 */
	async clear(): Promise<void> {
		// 1. Subscribed first, for the same reason as in `set`
		await this.subscribe();

		// 2. L2 first, then L1, in the same order as `set`
		await this.redis.clear();
		await this.local.clear();

		// 3. A message without a key means "drop everything"
		await this.clearOthers();
	}

	/**
	 * Acquire a distributed lock on the given key through L2.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock.
	 * @throws Error when the lock is still held once the L2 retry budget — about its `lockTimeout` — is spent.
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
	 * @throws Error when the lock is still held once the L2 retry budget — about its `lockTimeout` — is spent;
	 * whatever the callback throws.
	 */
	async usingLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
		// 1. Only the Redis lock is visible to other processes
		return await this.redis.usingLock(key, callback);
	}

	/**
	 * Quit the bus's subscriber connection; the process is shutting down.
	 *
	 * The only connection of the driver's own: L2 runs on the connection the caller handed in and is closed there, L1
	 * holds nothing. Reads still answer from what is cached; a write afterwards is refused, since no invalidation
	 * would reach this process any more.
	 *
	 * @returns Once the server acknowledged the quit.
	 */
	async close(): Promise<void> {
		// 1. Closed first, so a write racing the quit is already refused; the subscription is forgotten with the
		//    connection it lived on
		this.closed = true;
		this.subscribed = undefined;

		// 2. The bus duplicated the L2 connection for subscribing; that duplicate is what would keep the process alive
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

		// 2. A write of this process still waiting for its L2 reply may be older than the one this message announces,
		//    so it is kept out of L1 once it lands; a message without a key concerns every such write
		if (payload.key !== undefined) {
			const writing = this.writing.get(payload.key);

			if (writing) {
				writing.invalidated = true;
			}
		} else {
			for (const writing of this.writing.values()) {
				writing.invalidated = true;
			}
		}

		// 3. Drop the one key, or everything when the message carries no key
		if (payload.key !== undefined) {
			await this.local.delete(payload.key);
		} else {
			await this.local.clear();
		}
	}
}
