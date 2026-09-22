import { MAX_TIMER_DELAY } from '@novastarter/utils';
import { Redlock } from '@sesamecare-oss/redlock';
import type { Redis } from 'ioredis';
import {
	bufferToUint8Array,
	compress,
	decompress,
	deserialize,
	isCompressed,
	serialize,
	uint8ArrayToBuffer,
	withNamespace,
} from '../../../utils/index.js';
import type { KvDriver } from '../../driver.js';
import type { Lock } from '../../types.js';

/**
 * ioredis client extended with the Lua command {@link KvDriverRedis} defines on it.
 *
 * `defineCommand` adds the method at runtime; this interface makes it visible to the type-checker.
 */
export interface ExtendedRedis extends Redis {
	/**
	 * Store `value` only when it is larger than the current value of `key`.
	 *
	 * @param key - Namespaced key.
	 * @param value - Candidate value.
	 * @param ttl - Expiry to set along with the value, in milliseconds; none when omitted.
	 * @returns `1` when the value was stored, `0` otherwise.
	 */
	setMax(key: string, value: number, ttl?: number): Promise<number>;
}

/**
 * Options of {@link KvDriverRedis}, the `redis` driver.
 */
export type KvDriverRedisConfig = {
	/**
	 * Prefix for every key, so several stores can share one Redis instance.
	 */
	namespace: string;

	/**
	 * Enable gzip compression of stored values.
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
	 * How long an acquired lock is held, in milliseconds, and about how long `acquireLock` waits for a busy one
	 * before giving up. At least 200 and at most what a timer can hold: Redlock renews a lock `usingLock` holds
	 * before it expires — 500 ms ahead, or less for a short timeout — and needs 100 ms of headroom between the two.
	 *
	 * @defaultValue 5000
	 */
	lockTimeout?: number | undefined;

	/**
	 * Existing or new Redis connection to use with this store.
	 */
	redis: Redis | ExtendedRedis;

	/**
	 * Time-to-live: keys expire after this many milliseconds.
	 *
	 * Every write — `set`, `increment`, `setMax` — sets the expiry afresh, so a key lives this long after its last
	 * write, the way the local store's does.
	 */
	ttl?: number | undefined;
};

/**
 * Lua script behind `setMax`: store the value only when it beats the current one.
 *
 * Running the compare-and-set inside Redis makes it atomic; a GET followed by a SET from the client would let two
 * processes race each other. A second argument, when given, is the expiry in milliseconds set along with the value.
 * The answer is `1` or `0`, never a Lua boolean: Redis turns `false` into a nil reply, which the client reads as
 * `null`, not as `0`.
 */
export const SET_MAX_SCRIPT = `
  local key = KEYS[1]
  local value = tonumber(ARGV[1])
  local ttl = tonumber(ARGV[2])

  if redis.call("EXISTS", key) == 1 then
    local oldValue = tonumber(redis.call('GET', key))

    if value <= oldValue then
      return 0
    end
  end

  if ttl then
    redis.call('SET', key, value, 'PX', ttl)
  else
    redis.call('SET', key, value)
  end

  return 1
`;

/**
 * Key-value store backed by Redis, shared between processes.
 *
 * Values are JSON-serialized and, above a size threshold, gzip-compressed before they are written. Numbers are
 * stored as plain Redis integers instead, so `increment` and `setMax` can work on them natively. Locks are
 * distributed through Redlock and live under a namespace of their own (`<namespace>-locks`), so locking a key and
 * storing a value under it never collide, and `clear()` does not release the locks of a store it empties.
 *
 * @example
 * ```ts
 * const kv = new KvDriverRedis({
 * 	redis: new Redis(),
 * 	namespace: 'app',
 * });
 *
 * await kv.usingLock('migration', async () => {
 * 	// only one process at a time gets here
 * });
 * ```
 */
export class KvDriverRedis implements KvDriver {
	/**
	 * Client with the custom `setMax` command attached.
	 *
	 * @internal
	 */
	private readonly redis: ExtendedRedis;

	/**
	 * Prefix applied to every key.
	 *
	 * @internal
	 */
	private readonly namespace: string;

	/**
	 * Whether values above {@link KvDriverRedis.compressionMinSize} are gzipped.
	 *
	 * @internal
	 */
	private readonly compression: boolean;

	/**
	 * Smallest serialized size, in bytes, that gets compressed.
	 *
	 * @internal
	 */
	private readonly compressionMinSize: number;

	/**
	 * Duration a lock is held, in milliseconds.
	 *
	 * @internal
	 */
	private readonly lockTimeout: number;

	/**
	 * Distributed lock manager over the same client.
	 *
	 * @internal
	 */
	private readonly redlock;

	/**
	 * Namespace of the lock keys: the store's own with a `-locks` suffix, so a lock never shares its Redis key with
	 * the value stored under the same name, and the `<namespace>:*` scan of `clear()` does not match it.
	 *
	 * @internal
	 */
	private readonly lockNamespace: string;

	/**
	 * Expiry applied to every written key, in milliseconds, or `undefined` for no expiry.
	 *
	 * @internal
	 */
	private readonly ttl: number | undefined;

	/**
	 * Create the store on top of an existing Redis connection.
	 *
	 * @param config - Redis configuration.
	 * @throws RangeError when `lockTimeout` is under 200 ms or above what a timer can hold, or the client sits on a
	 * database above 15, where Redlock cannot lock.
	 */
	constructor(config: KvDriverRedisConfig) {
		// 1. Register the Lua command once per client; a client shared between several stores already has it. Locks
		//    need no command of their own: Redlock brings its own check-and-delete release script
		if (!('setMax' in config.redis)) {
			config.redis.defineCommand('setMax', {
				numberOfKeys: 1,
				lua: SET_MAX_SCRIPT,
			});
		}

		// 2. Apply the documented defaults: compress, but only from 1 kB up; hold locks for 5 s. Redlock renews a lock
		//    `using` holds ahead of its expiry and needs 100 ms between renewal and expiry, so a timeout under 200 ms
		//    leaves no room for that; a timeout a timer cannot hold — `Infinity` would retry for ever — is refused too
		this.redis = config.redis as ExtendedRedis;
		this.namespace = config.namespace;
		this.compression = config.compression ?? true;
		this.compressionMinSize = config.compressionMinSize ?? 1000;
		this.lockTimeout = Math.floor(config.lockTimeout ?? 5000);

		if (!(this.lockTimeout >= 200 && this.lockTimeout <= MAX_TIMER_DELAY)) {
			throw new RangeError(
				`KvDriverRedis: "lockTimeout" must be between 200 and ${MAX_TIMER_DELAY} ms, got ${config.lockTimeout}`,
			);
		}

		// 3. Redlock's Lua runs `SELECT` on the database it is told, 0 unless told, so the client's own database is
		//    passed along, or the locks would live in a different database than the values; a client without options
		//    — a test double — counts as database 0. Redlock only knows databases 0 to 15 and would silently fall
		//    back to 0 for a higher one, which is refused instead
		const db = this.redis.options?.db ?? 0;

		if (db > 15) {
			throw new RangeError(`KvDriverRedis: Redlock can only lock in databases 0 to 15, the client is on ${db}`);
		}

		// 4. Retry every ~50 ms for about `lockTimeout`, so `acquireLock` waits for a busy lock as long as the local
		//    store does before giving up. `using` renews a lock `automaticExtensionThreshold` ms before it expires and
		//    refuses a duration less than 100 ms above that threshold, which is 500 ms unless told: for a short lock
		//    timeout the threshold moves down to `lockTimeout - 100`, so a `lockTimeout` of 300 ms works instead of
		//    throwing
		this.redlock = new Redlock([this.redis], {
			retryDelay: 50,
			driftFactor: 0.01,
			retryCount: Math.ceil(this.lockTimeout / 50),
			retryJitter: 20,
			db,
			automaticExtensionThreshold: Math.min(500, Math.max(0, this.lockTimeout - 100)),
		});

		this.lockNamespace = `${this.namespace}-locks`;
		this.ttl = config.ttl;
	}

	/**
	 * Get the stored value by key.
	 *
	 * @typeParam T - Type the caller expects the value to be.
	 * @param key - Key to retrieve.
	 * @returns Stored value, or `undefined` when the key does not exist.
	 */
	async get<T = unknown>(key: string): Promise<T | undefined> {
		// 1. Read raw bytes; the string API would mangle compressed payloads
		const value = await this.redis.getBuffer(withNamespace(key, this.namespace));

		if (value === null) {
			return undefined;
		}

		// 2. Compression is decided per value on write, so detect it from the gzip header rather than from config
		let binaryArray = bufferToUint8Array(value);

		if (this.compression === true && isCompressed(binaryArray)) {
			binaryArray = await decompress(binaryArray);
		}

		return <T>deserialize(binaryArray);
	}

	/**
	 * Save the given value to the store.
	 *
	 * @typeParam T - Type of the value.
	 * @param key - Key to save.
	 * @param value - Value to save. Can be any JavaScript primitive, plain object or array.
	 */
	async set<T = unknown>(key: string, value: T): Promise<void> {
		// 1. Numbers are written as plain Redis integers, so `INCRBY` and the `setMax` script can read them
		if (typeof value === 'number') {
			if (this.ttl) {
				await this.redis.set(withNamespace(key, this.namespace), value, 'PX', this.ttl);
			} else {
				await this.redis.set(withNamespace(key, this.namespace), value);
			}
		} else {
			// 2. Everything else is serialized and, when large enough to be worth it, compressed
			let binaryArray = serialize(value);

			if (this.compression === true && binaryArray.byteLength >= this.compressionMinSize) {
				binaryArray = await compress(binaryArray);
			}

			// 3. `PX` sets the expiry in the same round trip as the write
			if (this.ttl) {
				await this.redis.set(withNamespace(key, this.namespace), uint8ArrayToBuffer(binaryArray), 'PX', this.ttl);
			} else {
				await this.redis.set(withNamespace(key, this.namespace), uint8ArrayToBuffer(binaryArray));
			}
		}
	}

	/**
	 * Remove the given key from the store.
	 *
	 * @param key - Key to remove.
	 */
	async delete(key: string): Promise<void> {
		// 1. `UNLINK` frees the memory on a background thread, unlike `DEL`, which blocks on large values
		await this.redis.unlink(withNamespace(key, this.namespace));
	}

	/**
	 * Check whether a key exists in the store.
	 *
	 * @param key - Key to check.
	 * @returns `true` when the key exists.
	 */
	async has(key: string): Promise<boolean> {
		// 1. `EXISTS` answers with the number of matching keys
		const exists = await this.redis.exists(withNamespace(key, this.namespace));

		return exists !== 0;
	}

	/**
	 * Increment the stored number by the given amount, atomically.
	 *
	 * @param key - Key to increment; a missing key counts as `0`.
	 * @param amount - Amount to add. Defaults to `1`.
	 * @returns Updated value.
	 */
	async increment(key: string, amount = 1): Promise<number> {
		// 1. `INCRBY` is atomic inside Redis, so concurrent processes never lose an increment; without an expiry it is
		//    the whole write
		const namespaced = withNamespace(key, this.namespace);

		if (!this.ttl) {
			return await this.redis.incrby(namespaced, amount);
		}

		// 2. With an expiry, `INCRBY` alone would leave a key created here living for good: the expiry is set in the
		//    same transaction, so the key never exists without one
		const replies = await this.redis.multi().incrby(namespaced, amount).pexpire(namespaced, this.ttl).exec();

		// 3. A transaction resolves even when a command failed — the failure sits in that command's reply — so the
		//    `INCRBY` reply is checked and its error thrown, the way a plain `incrby` call would reject
		const [error, count] = replies?.[0] ?? [new Error('The increment transaction was aborted'), null];

		if (error) {
			throw error;
		}

		return Number(count);
	}

	/**
	 * Save the given number only when it is larger than the stored one, atomically.
	 *
	 * @param key - Key to save.
	 * @param value - Number to save when it beats the current value.
	 * @returns `true` when the value was saved.
	 */
	async setMax(key: string, value: number): Promise<boolean> {
		// 1. The expiry travels with the value into the script, so a key stored here expires like one `set` wrote
		const namespaced = withNamespace(key, this.namespace);

		const wasSet = this.ttl
			? await this.redis.setMax(namespaced, value, this.ttl)
			: await this.redis.setMax(namespaced, value);

		// 2. The Lua script answers `1` or `0`; only `1` means stored, so anything else — including a `null` an older
		//    script build would answer with for "not stored" — reads as `false`
		return wasSet === 1;
	}

	/**
	 * Acquire a distributed lock on the given key, waiting for it to become free.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock; `release()` throws at once, without retrying, when the lock had
	 * already expired — the holder outran its `lockTimeout` without extending — and does nothing the second time.
	 * @throws When the lock cannot be acquired within the retry budget.
	 */
	async acquireLock(key: string): Promise<Lock> {
		// 1. Wait for the lock under the locks namespace; the timeout was floored to the integer Redlock wants
		let lock = await this.redlock.acquire([withNamespace(key, this.lockNamespace)], this.lockTimeout);
		let released = false;

		// 2. Wrap the Redlock lock in the backend-agnostic handle shape. Redlock's `extend()` invalidates the lock
		//    object it was called on and answers with a new one, so the handle follows that new object: extending
		//    through the old one a second time would throw "already expired" while Redis still holds the lock. The
		//    release runs without retries: a lock that is gone — expired while the holder overran its timeout — is a
		//    failed vote Redlock would otherwise retry for the whole acquire budget before reporting it
		return {
			release: async () => {
				// 1. Once only, like the local store's handle: a second release must not go to Redis for a lock this
				//    holder already gave back and report it as gone
				if (released) {
					return;
				}

				released = true;
				await this.redlock.release(lock, { retryCount: 0 });
			},
			extend: async (duration: number) => {
				lock = await lock.extend(Math.floor(duration));
			},
		};
	}

	/**
	 * Run a callback while holding a distributed lock on the given key, releasing it afterwards.
	 *
	 * @typeParam T - Value the callback resolves to.
	 * @param key - Key to lock.
	 * @param callback - Work to run under the lock.
	 * @returns Whatever the callback resolves to.
	 * @throws When the lock cannot be acquired within the retry budget.
	 */
	async usingLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
		// 1. Redlock's `using` also auto-extends the lock while the callback is still running. Its release uses the
		//    acquire retry budget, so a lock gone at release time — expired after the callback blocked the event loop
		//    past the timeout, or removed by hand — is reported only after about `lockTimeout` of retries
		return this.redlock.using([withNamespace(key, this.lockNamespace)], this.lockTimeout, callback);
	}

	/**
	 * Remove all keys in this store's namespace.
	 */
	async clear(): Promise<void> {
		// 1. `SCAN` instead of `KEYS`, so a large keyspace does not block the Redis server
		const keysStream = this.redis.scanStream({
			match: withNamespace('*', this.namespace),
		});

		// 2. Queue every batch into one pipeline and send it in a single round trip. A `SCAN` step may match nothing
		//    and still answer with an empty batch; `UNLINK` without keys is an error, so such a batch is skipped
		const pipeline = this.redis.pipeline();

		for await (const keys of keysStream as AsyncIterable<string[]>) {
			if (keys.length > 0) {
				pipeline.unlink(keys);
			}
		}

		await pipeline.exec();
	}
}
