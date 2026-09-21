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
	 * How long an acquired lock is held, in milliseconds.
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
 * distributed through Redlock.
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
	 * Expiry applied to every written key, in milliseconds, or `undefined` for no expiry.
	 *
	 * @internal
	 */
	private readonly ttl: number | undefined;

	/**
	 * Create the store on top of an existing Redis connection.
	 *
	 * @param config - Redis configuration.
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

		// 2. Apply the documented defaults: compress, but only from 1 kB up; hold locks for 5 s
		this.redis = config.redis as ExtendedRedis;
		this.namespace = config.namespace;
		this.compression = config.compression ?? true;
		this.compressionMinSize = config.compressionMinSize ?? 1000;
		this.lockTimeout = config.lockTimeout ?? 5000;

		// 3. Retry up to 100 times with ~50 ms between attempts, so `acquireLock` waits about 5 s for a busy lock
		//    before giving up, in line with the default lock timeout
		this.redlock = new Redlock([this.redis], {
			retryDelay: 50,
			driftFactor: 0.01,
			retryCount: 100,
			retryJitter: 20,
		});

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
		//    same transaction, so the key never exists without one and the count is read from the first reply
		const replies = await this.redis.multi().incrby(namespaced, amount).pexpire(namespaced, this.ttl).exec();

		return Number(replies?.[0]?.[1]);
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
	 * @returns Handle to release or extend the lock.
	 * @throws When the lock cannot be acquired within the retry budget.
	 */
	async acquireLock(key: string): Promise<Lock> {
		// 1. Redlock wants an integer duration, so floor a possibly fractional timeout
		const lock = await this.redlock.acquire([withNamespace(key, this.namespace)], Math.floor(this.lockTimeout));

		// 2. Wrap the Redlock lock in the backend-agnostic handle shape
		return {
			release: async () => {
				await lock.release();
			},
			extend: async (duration: number) => {
				await lock.extend(duration);
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
		// 1. Redlock's `using` also auto-extends the lock while the callback is still running
		return this.redlock.using([withNamespace(key, this.namespace)], Math.floor(this.lockTimeout), callback);
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
