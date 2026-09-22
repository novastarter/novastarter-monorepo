import { MAX_TIMER_DELAY } from '@novastarter/utils';
import { ExecutionError, Redlock, type Lock as RedlockLock } from '@sesamecare-oss/redlock';
import type { Redis } from 'ioredis';
import {
	bufferToUint8Array,
	compress,
	decompress,
	deserialize,
	escapeGlob,
	isCompressed,
	serialize,
	uint8ArrayToBuffer,
	withNamespace,
} from '../../../utils/index.js';
import type { KvDriver } from '../../driver.js';
import type { Lock } from '../../types.js';

/**
 * ioredis client extended with the Lua commands {@link KvDriverRedis} defines on it.
 *
 * `defineCommand` adds the methods at runtime; this interface makes them visible to the type-checker.
 */
export interface ExtendedRedis extends Redis {
	/**
	 * Store `value` only when it is larger than the current value of `key`.
	 *
	 * @param key - Namespaced key.
	 * @param value - Candidate value.
	 * @param ttl - Expiry to set along with the value, in milliseconds; none when omitted.
	 * @returns `1` when the value was stored, `0` when the current value is as large or larger, `-1` when the current
	 * value is not a number.
	 */
	setMax(key: string, value: number, ttl?: number): Promise<number>;

	/**
	 * Add `amount` to the integer under `key` and give the key an expiry once the addition went through.
	 *
	 * @param key - Namespaced key.
	 * @param amount - Integer to add.
	 * @param ttl - Expiry to set after the increment, in milliseconds; none when omitted.
	 * @returns The updated value.
	 */
	increment(key: string, amount: number, ttl?: number): Promise<number>;
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
 * The answer is a number, never a Lua boolean — Redis turns `false` into a nil reply, which the client reads as
 * `null`, not as `0`: `1` stored, `0` not larger, `-1` when the current value is no number at all — a JSON string,
 * `null`, a compressed payload — which the driver turns into the error the local store throws for the same key,
 * instead of the Lua comparison error the script would otherwise die with.
 */
export const SET_MAX_SCRIPT = `
  local key = KEYS[1]
  local value = tonumber(ARGV[1])
  local ttl = tonumber(ARGV[2])
  local current = redis.call('GET', key)

  if current then
    local oldValue = tonumber(current)

    if oldValue == nil then
      return -1
    end

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
 * Lua script behind `increment`: add to the integer under the key, then give the key its expiry.
 *
 * A second argument, when given, is the expiry in milliseconds. It is set only once `INCRBY` went through: in a
 * `MULTI`, a `PEXPIRE` queued after a failing `INCRBY` still runs, so an increment refused for a non-integer value
 * would extend the life of the very key it could not touch, where the local store leaves such a key as it was. A
 * failing `INCRBY` aborts the script, and its reply error reaches the client as it would from the plain command.
 */
export const INCREMENT_SCRIPT = `
  local value = redis.call('INCRBY', KEYS[1], ARGV[1])

  if ARGV[2] then
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
  end

  return value
`;

/**
 * Key-value store backed by Redis, shared between processes.
 *
 * Values are JSON-serialized and, above a size threshold, gzip-compressed before they are written. Finite numbers
 * are stored as plain Redis numbers instead, so `increment` and `setMax` can work on them natively; `NaN` and the
 * infinities take the JSON path and land as `null`, as they do in the local store. What fails on one backend fails
 * on the other with the same error: a non-integer under `increment`, a non-number under `setMax`, a lock still held
 * once `lockTimeout` is spent. Locks are distributed through Redlock and live under a namespace of their own
 * (`<namespace>-locks`), so locking a key and storing a value under it never collide, and `clear()` does not
 * release the locks of a store it empties.
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
	 * Client with the custom `setMax` and `increment` commands attached.
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
		// 1. Register the Lua commands once per client; a client shared between several stores already has them. Locks
		//    need no command of their own: Redlock brings its own check-and-delete release script
		if (!('setMax' in config.redis)) {
			config.redis.defineCommand('setMax', {
				numberOfKeys: 1,
				lua: SET_MAX_SCRIPT,
			});
		}

		if (!('increment' in config.redis)) {
			config.redis.defineCommand('increment', {
				numberOfKeys: 1,
				lua: INCREMENT_SCRIPT,
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
		// 1. Finite numbers are written as plain Redis numbers, so `INCRBY` and the `setMax` script can read them. A
		//    `NaN` or infinity written that way would be the text `NaN` or `Infinity`, which is not JSON: every later
		//    `get` of the key would throw until it is deleted. Those take the JSON path below and land as `null`,
		//    as `JSON.stringify` makes them in the local store
		if (typeof value === 'number' && Number.isFinite(value)) {
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
	 * Increment the stored integer by the given amount, atomically.
	 *
	 * @param key - Key to increment; a missing key counts as `0`.
	 * @param amount - Integer to add. Defaults to `1`.
	 * @returns Updated value.
	 * @throws RangeError when `amount` is not an integer.
	 * @throws Error when the stored value is not an integer — the same error the local store throws, with the
	 * `INCRBY` reply error as `cause`; the key keeps its value and its expiry.
	 */
	async increment(key: string, amount = 1): Promise<number> {
		// 1. `INCRBY` takes integers only; a fraction or `NaN` is refused here, before the round trip, with the error
		//    the local store throws, instead of as a reply error whose wording depends on the Redis version
		if (!Number.isInteger(amount)) {
			throw new RangeError(`The amount for key "${key}" must be an integer, got ${amount}`);
		}

		// 2. The script runs `INCRBY` — atomic, so concurrent processes never lose an increment — and sets the expiry
		//    only once the increment went through, so a key created here never lives for good and a refused increment
		//    does not renew the key it could not touch
		const namespaced = withNamespace(key, this.namespace);

		try {
			return this.ttl
				? await this.redis.increment(namespaced, amount, this.ttl)
				: await this.redis.increment(namespaced, amount);
		} catch (error) {
			// 3. A value `INCRBY` cannot read as an integer — a JSON string, `null`, a fraction, a compressed payload —
			//    comes back as a reply error; rethrown as the error the local store throws for the same key, so a
			//    caller handles both backends alike, with the reply kept as the cause
			if (error instanceof Error && error.message.includes('not an integer')) {
				throw new Error(`The value for key "${key}" is not an integer.`, { cause: error });
			}

			throw error;
		}
	}

	/**
	 * Save the given number only when it is larger than the stored one, atomically.
	 *
	 * @param key - Key to save.
	 * @param value - Finite number to save when it beats the current value.
	 * @returns `true` when the value was saved.
	 * @throws RangeError when `value` is `NaN` or infinite.
	 * @throws Error when the stored value is not a number — the same error the local store throws.
	 */
	async setMax(key: string, value: number): Promise<boolean> {
		// 1. `NaN` and the infinities would reach the script as text Lua's `tonumber` cannot read, and die there in a
		//    comparison with nil; refused up front instead, with the error the local store throws
		if (!Number.isFinite(value)) {
			throw new RangeError(`The value for key "${key}" must be a finite number, got ${value}`);
		}

		// 2. The expiry travels with the value into the script, so a key stored here expires like one `set` wrote
		const namespaced = withNamespace(key, this.namespace);

		const wasSet = this.ttl
			? await this.redis.setMax(namespaced, value, this.ttl)
			: await this.redis.setMax(namespaced, value);

		// 3. The script answers `-1` for a current value that is no number, which the local store refuses with an
		//    error rather than a `false` that would read as "not larger"
		if (wasSet === -1) {
			throw new Error(`The value for key "${key}" is not a number.`);
		}

		// 4. Only `1` means stored, so anything else — including a `null` an older script build would answer with for
		//    "not stored" — reads as `false`
		return wasSet === 1;
	}

	/**
	 * Acquire a distributed lock on the given key, waiting for it to become free.
	 *
	 * @param key - Key to lock.
	 * @returns Handle to release or extend the lock; `release()` throws at once, without retrying, when the lock had
	 * already expired — the holder outran its `lockTimeout` without extending — and does nothing the second time.
	 * @throws Error when the lock is still held once the retry budget — about `lockTimeout` — is spent: the error the
	 * local store throws, with Redlock's quorum failure as `cause`.
	 */
	async acquireLock(key: string): Promise<Lock> {
		// 1. Wait for the lock under the locks namespace; the timeout was floored to the integer Redlock wants. Redlock
		//    reports a spent retry budget as a quorum failure that names neither the key nor the budget; it is
		//    rethrown as the error the local store throws, so a caller handles both backends alike
		let lock: RedlockLock;

		try {
			lock = await this.redlock.acquire([withNamespace(key, this.lockNamespace)], this.lockTimeout);
		} catch (error) {
			throw this.toLockError(key, error);
		}

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
				// 1. Follow the lock Redlock answers with, since it invalidates the one it was called on; floored,
				//    because Redlock wants an integer
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
	 * @throws Error when the lock is still held once the retry budget — about `lockTimeout` — is spent, the same
	 * error `acquireLock` throws; whatever the callback throws.
	 */
	async usingLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
		// 1. Redlock's `using` also auto-extends the lock while the callback is still running. Its release uses the
		//    acquire retry budget, so a lock gone at release time — expired after the callback blocked the event loop
		//    past the timeout, or removed by hand — is reported only after about `lockTimeout` of retries. The
		//    callback marks that it ran, which is what tells a quorum failure of the acquire from one of that release
		let started = false;

		try {
			return await this.redlock.using([withNamespace(key, this.lockNamespace)], this.lockTimeout, async () => {
				// 1. Reached only once the lock was acquired, so a later quorum failure cannot be the acquire's
				started = true;

				return await callback();
			});
		} catch (error) {
			// 2. A quorum failure before the callback ran is the acquire giving up on a busy lock: rethrown as the error
			//    the local store throws. Everything else — the callback's own error, a release that found the lock
			//    gone — passes through as it is
			throw started ? error : this.toLockError(key, error);
		}
	}

	/**
	 * Turn Redlock's quorum failure into the error the local store throws for a lock still held past its budget.
	 *
	 * Anything else — a network error, an argument Redlock refused — is answered back unchanged, since it is not a
	 * busy lock and must not be reported as one.
	 *
	 * @param key - Key that was being locked.
	 * @param error - What Redlock threw.
	 * @returns The error to throw in its place.
	 * @internal
	 */
	private toLockError(key: string, error: unknown): unknown {
		// 1. Only a spent retry window is a busy lock; the Redlock error stays reachable as the cause, with its votes
		if (error instanceof ExecutionError) {
			return new Error(`Lock "${key}" was not acquired within ${this.lockTimeout} ms`, { cause: error });
		}

		return error;
	}

	/**
	 * Remove all keys in this store's namespace.
	 */
	async clear(): Promise<void> {
		// 1. `SCAN` instead of `KEYS`, so a large keyspace does not block the Redis server. The namespace is escaped,
		//    since `MATCH` reads `*`, `?`, `[`, `]` and `\` in it as pattern operators: unescaped, a namespace such as
		//    `tenant[1]` would unlink another store's keys and leave its own in place
		const keysStream = this.redis.scanStream({
			match: withNamespace('*', escapeGlob(this.namespace)),
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
