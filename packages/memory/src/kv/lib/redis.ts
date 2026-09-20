import { Redlock } from '@sesamecare-oss/redlock';
import {
	bufferToUint8Array,
	compress,
	decompress,
	deserialize,
	isCompressed,
	serialize,
	uint8ArrayToBuffer,
	withNamespace,
} from '../../utils/index.js';
import type { Kv } from '../types/class.js';
import type { ExtendedRedis, KvDriverRedisConfig } from '../types/config.js';

/**
 * Lua script behind `setMax`: store the value only when it beats the current one.
 *
 * Running the compare-and-set inside Redis makes it atomic; a GET followed by a SET from the client would let two
 * processes race each other.
 */
export const SET_MAX_SCRIPT = `
  local key = KEYS[1]
  local value = tonumber(ARGV[1])

  if redis.call("EXISTS", key) == 1 then
    local oldValue = tonumber(redis.call('GET', key))

    if value <= oldValue then
      return false
    end
  end

  redis.call('SET', key, value)

  return true
`;

/**
 * Lua script behind `release`: delete the key only when it still holds the expected value.
 *
 * A lock holder must not delete a lock that has since expired and been taken by somebody else, hence the check.
 *
 * @internal
 */
const RELEASE_SCRIPT = `
	if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
	else
	return 0
	end
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
export class KvDriverRedis implements Kv {
	/**
	 * Client with the custom `setMax` and `release` commands attached.
	 *
	 * @internal
	 */
	private redis: ExtendedRedis;

	/**
	 * Prefix applied to every key.
	 *
	 * @internal
	 */
	private namespace: string;

	/**
	 * Whether values above {@link KvDriverRedis.compressionMinSize} are gzipped.
	 *
	 * @internal
	 */
	private compression: boolean;

	/**
	 * Smallest serialized size, in bytes, that gets compressed.
	 *
	 * @internal
	 */
	private compressionMinSize: number;

	/**
	 * Duration a lock is held, in milliseconds.
	 *
	 * @internal
	 */
	private lockTimeout: number;

	/**
	 * Distributed lock manager over the same client.
	 *
	 * @internal
	 */
	private redlock;

	/**
	 * Expiry applied to every written key, in milliseconds, or `undefined` for no expiry.
	 *
	 * @internal
	 */
	private ttl: number | undefined;

	/**
	 * Create the store on top of an existing Redis connection.
	 *
	 * @param config - Redis configuration.
	 */
	constructor(config: KvDriverRedisConfig) {
		// 1. Register the Lua commands once per client; a client shared between several stores already has them
		if ('setMax' in config.redis === false) {
			config.redis.defineCommand('setMax', {
				numberOfKeys: 1,
				lua: SET_MAX_SCRIPT,
			});
		}

		if ('release' in config.redis === false) {
			config.redis.defineCommand('release', {
				numberOfKeys: 1,
				lua: RELEASE_SCRIPT,
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
		// 1. `INCRBY` is atomic inside Redis, so concurrent processes never lose an increment
		return await this.redis.incrby(withNamespace(key, this.namespace), amount);
	}

	/**
	 * Save the given number only when it is larger than the stored one, atomically.
	 *
	 * @param key - Key to save.
	 * @param value - Number to save when it beats the current value.
	 * @returns `true` when the value was saved.
	 */
	async setMax(key: string, value: number): Promise<boolean> {
		// 1. The Lua script answers `1` or `0`; translate to a boolean for the interface
		const wasSet = await this.redis.setMax(withNamespace(key, this.namespace), value);

		return wasSet !== 0;
	}

	/**
	 * Acquire a distributed lock on the given key, waiting for it to become free.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock.
	 * @throws When the lock cannot be acquired within the retry budget.
	 */
	async acquireLock(key: string): Promise<{
		release: () => Promise<void>;
		extend: (duration: number) => Promise<void>;
	}> {
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

		// 2. Queue every batch into one pipeline and send it in a single round trip
		const pipeline = this.redis.pipeline();

		for await (const keys of keysStream) {
			pipeline.unlink(keys);
		}

		await pipeline.exec();
	}
}
