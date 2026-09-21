import { LRUCache } from 'lru-cache';
import { deserialize, serialize } from '../../../utils/index.js';
import type { Kv } from '../../driver.js';

/**
 * Options of {@link KvDriverLocal}, the `local` driver.
 */
export type KvDriverLocalConfig = {
	/**
	 * Maximum number of keys in the store; the least recently used key is evicted beyond it.
	 */
	maxKeys?: number | undefined;

	/**
	 * Time-to-live: keys expire after this many milliseconds.
	 */
	ttl?: number | undefined;
};

/**
 * In-memory key-value store for a single process.
 *
 * Values are serialized to bytes on write and deserialized on read, the same way the Redis store does it, so a
 * caller cannot mutate a stored object through the reference it passed in. Locks are no-ops: with a single process
 * there is nobody to lock against.
 *
 * @example
 * ```ts
 * const kv = new KvDriverLocal({
 * 	maxKeys: 500,
 * 	ttl: 60_000,
 * });
 *
 * await kv.set('my-key', { hello: 'world' });
 * ```
 */
export class KvDriverLocal implements Kv {
	/**
	 * Backing store: an LRU when a size or time limit is configured, a plain `Map` otherwise.
	 *
	 * @internal
	 */
	private store: LRUCache<string, Uint8Array, unknown> | Map<string, Uint8Array>;

	/**
	 * Create the store with optional size and time limits.
	 *
	 * @param config - Local configuration.
	 */
	constructor(config: KvDriverLocalConfig) {
		// 1. `LRUCache` refuses to be constructed without `max` or `ttl`, so fall back to a plain `Map` when neither
		//    limit is configured
		if (config.maxKeys || config.ttl) {
			const options: Record<string, unknown> = {};

			if (config.maxKeys) {
				options['max'] = config.maxKeys;
			}

			// 2. With a ttl, purge expired entries on a timer; by default the LRU only drops them lazily on access,
			//    which would let a write-heavy store grow until reads happen
			if (config.ttl) {
				options['ttl'] = config.ttl;
				options['ttlAutopurge'] = true;
			}

			this.store = new LRUCache(options as any);
		} else {
			this.store = new Map();
		}
	}

	/**
	 * Get the stored value by key.
	 *
	 * @typeParam T - Type the caller expects the value to be.
	 * @param key - Key to retrieve.
	 * @returns Stored value, or `undefined` when the key does not exist.
	 */
	get<T = unknown>(key: string): T | undefined {
		// 1. Deserialize a fresh copy, so callers never share a reference with the store
		const value = this.store.get(key);

		if (value !== undefined) {
			return deserialize<T>(value);
		}

		return undefined;
	}

	/**
	 * Save the given value to the store.
	 *
	 * @param key - Key to save.
	 * @param value - Value to save. Can be any JavaScript primitive, plain object or array.
	 */
	set(key: string, value: unknown): void {
		// 1. Store bytes rather than the object itself, matching the Redis store's copy semantics
		const serialized = serialize(value);
		this.store.set(key, serialized);
	}

	/**
	 * Remove the given key from the store.
	 *
	 * @param key - Key to remove.
	 */
	delete(key: string): void {
		// 1. Both backing stores share the `Map` delete signature
		this.store.delete(key);
	}

	/**
	 * Check whether a key exists in the store.
	 *
	 * @param key - Key to check.
	 * @returns `true` when the key exists.
	 */
	has(key: string): boolean {
		// 1. The LRU's `has` does not refresh recency, so a probe does not keep a key alive
		return this.store.has(key);
	}

	/**
	 * Increment the stored number by the given amount.
	 *
	 * @param key - Key to increment; a missing key counts as `0`.
	 * @param amount - Amount to add. Defaults to `1`.
	 * @returns Updated value.
	 * @throws `Error` when the stored value is not a number.
	 */
	increment(key: string, amount: number = 1): number {
		// 1. Start from zero for a missing key, so counters need no explicit initialisation
		const currentVal = this.get(key) ?? 0;

		// 2. Refuse to add to a non-number instead of producing `NaN` or string concatenation
		if (typeof currentVal !== 'number') {
			throw new Error(`The value for key "${key}" is not a number.`);
		}

		// 3. Everything runs synchronously, so concurrent callers cannot interleave between read and write
		const newVal = currentVal + amount;

		this.set(key, newVal);

		return newVal;
	}

	/**
	 * Save the given number only when it is larger than the stored one.
	 *
	 * @param key - Key to save.
	 * @param value - Number to save when it beats the current value.
	 * @returns `true` when the value was saved.
	 * @throws `Error` when the stored value is not a number.
	 */
	setMax(key: string, value: number): boolean {
		// 1. A missing key counts as zero, the same baseline `increment` uses
		const currentVal = this.get(key) ?? 0;

		// 2. Comparing against a non-number would be meaningless, so refuse it
		if (typeof currentVal !== 'number') {
			throw new Error(`The value for key "${key}" is not a number.`);
		}

		// 3. Equal values are not "larger", so they are rejected as well
		if (currentVal >= value) {
			return false;
		}

		this.set(key, value);

		return true;
	}

	/**
	 * Hand out a lock handle that does nothing.
	 *
	 * A single process has no competing holders, so there is nothing to wait for or release; the handle exists so
	 * callers can be written against the `Kv` interface without caring about the backend.
	 *
	 * @param _key - Key to lock; unused.
	 * @returns Handle whose `release` and `extend` resolve immediately.
	 */
	acquireLock(_key: string): {
		release: () => Promise<void>;
		extend: (_duration: number) => Promise<void>;
	} {
		// 1. Return inert callbacks with the same shape as the Redis lock
		return {
			release: async () => {},
			extend: async (_duration: number) => {},
		};
	}

	/**
	 * Run a callback "under a lock", which locally means running it right away.
	 *
	 * @typeParam T - Value the callback resolves to.
	 * @param _key - Key to lock; unused.
	 * @param callback - Work to run.
	 * @returns Whatever the callback resolves to.
	 */
	usingLock<T>(_key: string, callback: () => Promise<T>): Promise<T> {
		// 1. No lock to take, so just run the work
		return callback();
	}

	/**
	 * Remove all keys from the store.
	 */
	clear(): void {
		// 1. Both backing stores share the `Map` clear signature
		this.store.clear();
	}
}
