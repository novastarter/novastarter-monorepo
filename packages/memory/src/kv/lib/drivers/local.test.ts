/**
 * Tests of `memory/kv/lib/drivers/local`.
 */
import { InvalidConfigError } from '@novastarter/errors';
import { LRUCache } from 'lru-cache';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { deserialize, serialize } from '../../../utils/index.js';
import { KvDriverLocal } from './local.js';

vi.mock('lru-cache');
vi.mock('../../../utils/index.js');

let kv: KvDriverLocal;

beforeEach(() => {
	// `lru-cache` is automocked, so the store built here already answers with mock functions
	kv = new KvDriverLocal({ maxKeys: 2 });
});

afterEach(() => {
	// Calls are cleared, not the implementations, so a `mockReturnValue` of one test does not leak into the next
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Instantiates LRU cache with configuration', () => {
		expect(LRUCache).toHaveBeenCalledWith({
			max: 2,
		});
	});

	test('Defaults to JS map if LRU config is not set', () => {
		// `LRUCache` refuses to be built without `max` or `ttl`, so an unlimited store is a plain `Map`
		vi.mocked(LRUCache).mockClear();
		kv = new KvDriverLocal({});
		expect(LRUCache).not.toHaveBeenCalled();
		expect(kv['store']).toBeInstanceOf(Map);
	});

	test.each([{ maxKeys: 10 }, { ttl: 5000 }])('Instantiates LRU cache if ttl OR maxKeys are provided', (config) => {
		vi.mocked(LRUCache).mockClear();
		kv = new KvDriverLocal(config);
		expect(LRUCache).toHaveBeenCalled();
	});

	test('Instantiates LRU cache with ttl + auto purge to prevent stale cache', () => {
		// Without autopurge the LRU drops expired keys only on access, so a write-heavy store would grow unread
		vi.mocked(LRUCache).mockClear();
		kv = new KvDriverLocal({ ttl: 5000 });
		expect(LRUCache).toHaveBeenCalledWith({ ttl: 5000, ttlAutopurge: true });
	});
});

describe('get', () => {
	test('Returns undefined if LRU cache is undefined', async () => {
		const mockKey = 'kv-key';

		vi.mocked(kv['store'].get).mockReturnValueOnce(undefined);

		const value = await kv.get(mockKey);

		expect(kv['store'].get).toHaveBeenCalledWith(mockKey);
		expect(value).toBeUndefined();
	});

	test('Returns deserialized value if store contains key', async () => {
		// A fresh copy rather than a shared reference
		const mockKey = 'kv-key';
		const mockStoredValue = new Uint8Array([1, 2, 3]);
		const mockDeserialized = 'mock-deserialized';

		vi.mocked(kv['store'].get).mockReturnValueOnce(mockStoredValue);
		vi.mocked(deserialize).mockReturnValueOnce(mockDeserialized);

		const value = await kv.get(mockKey);

		expect(kv['store'].get).toHaveBeenCalledWith(mockKey);
		expect(deserialize).toHaveBeenCalledWith(mockStoredValue);
		expect(value).toBe(mockDeserialized);
	});
});

describe('set', () => {
	test('Saves serialized value to store', async () => {
		// Bytes rather than the value itself, matching the Redis store's copy semantics
		const mockKey = 'kv-key';
		const mockValue = 'kv-value';
		const mockSerialized = new Uint8Array([1, 2, 3]);

		vi.mocked(serialize).mockReturnValue(mockSerialized);

		await kv.set(mockKey, mockValue);

		expect(serialize).toHaveBeenCalledWith(mockValue);
		expect(kv['store'].set).toHaveBeenCalledWith(mockKey, mockSerialized);
	});
});

describe('increment', () => {
	test('Sets value to 1 if no value exists', async () => {
		// A missing key counts as zero, so a counter needs no initialisation
		const mockKey = 'kv-key';

		kv.set = vi.fn();

		await kv.increment(mockKey);

		expect(kv.set).toHaveBeenCalledWith(mockKey, 1);
	});

	test('Sets value to passed amount if no value exists', async () => {
		const mockKey = 'kv-key';
		const mockAmount = 15;

		kv.set = vi.fn();

		await kv.increment(mockKey, mockAmount);

		expect(kv.set).toHaveBeenCalledWith(mockKey, mockAmount);
	});

	test('Sets value to existing + passed amount if value exists', async () => {
		const mockKey = 'kv-key';
		const mockValue = 42;
		const mockAmount = 15;

		vi.mocked(kv['store'].get).mockReturnValue(new Uint8Array([1]));
		vi.mocked(deserialize).mockReturnValue(mockValue);
		kv.set = vi.fn();

		await kv.increment(mockKey, mockAmount);

		expect(kv.set).toHaveBeenCalledWith(mockKey, mockValue + mockAmount);
	});

	test.each(['not-a-number', null, 1.5, undefined])(
		'Errors without writing if the key holds %s, which is not an integer',
		async (stored) => {
			// Redis refuses these for `INCRBY`; the local store refuses them the same way instead of restarting the
			// counter from zero (`null`, an empty payload) or adding to a fraction
			const mockKey = 'kv-key';

			vi.mocked(kv['store'].get).mockReturnValue(new Uint8Array([1]));
			vi.mocked(deserialize).mockReturnValue(stored);
			kv.set = vi.fn();

			expect(() => kv.increment(mockKey)).toThrow('The value for key "kv-key" is not an integer.');

			expect(kv.set).not.toHaveBeenCalled();
		},
	);

	test.each([0.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'Refuses the amount %s before touching the store',
		(amount) => {
			// `INCRBY` takes integers only, so an amount that would work here and fail on Redis is refused here too, as a
			// `RangeError` on the argument rather than an error on the key
			kv.set = vi.fn();

			expect(() => kv.increment('kv-key', amount)).toThrow(RangeError);

			expect(() => kv.increment('kv-key', amount)).toThrow(
				`The amount for key "kv-key" must be an integer, got ${amount}`,
			);

			expect(kv['store'].get).not.toHaveBeenCalled();
			expect(kv.set).not.toHaveBeenCalled();
		},
	);
});

describe('setMax', () => {
	test('Errors if key does not contain number', async () => {
		// A stored string compares with nothing, so the call fails rather than answering `false`
		const mockKey = 'kv-key';
		const mockValue = 42;
		const mockStoredValue = 'not-a-number';

		vi.mocked(kv['store'].get).mockReturnValue(new Uint8Array([1]));
		vi.mocked(deserialize).mockReturnValue(mockStoredValue);

		expect(() => kv.setMax(mockKey, mockValue)).toThrowErrorMatchingInlineSnapshot(
			'[Error: The value for key "kv-key" is not a number.]',
		);
	});

	test('Errors for an empty stored payload instead of treating it as a missing key', async () => {
		// `set(key, undefined)` stores empty bytes that deserialize to `undefined`; Redis refuses those as a
		// non-number, so the local store must not take them for an absent key and overwrite them
		vi.mocked(kv['store'].get).mockReturnValue(new Uint8Array());
		vi.mocked(deserialize).mockReturnValue(undefined);
		kv.set = vi.fn();

		expect(() => kv.setMax('kv-key', 42)).toThrow('The value for key "kv-key" is not a number.');
		expect(kv.set).not.toHaveBeenCalled();
	});

	test('Stores any number, zero or negative included, when the key does not exist', async () => {
		// The Redis script behaves the same, so the two backends agree
		const mockKey = 'kv-key';

		kv.set = vi.fn();

		expect(kv.setMax(mockKey, -5)).toBe(true);
		expect(kv.set).toHaveBeenCalledWith(mockKey, -5);

		expect(kv.setMax(mockKey, 0)).toBe(true);
		expect(kv.set).toHaveBeenCalledWith(mockKey, 0);
	});

	test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		'Refuses %s before touching the store',
		(value) => {
			// Stored, these would become JSON `null` and poison every later `setMax` on the key; the Redis store refuses
			// them too, so both backends fail alike
			kv.set = vi.fn();

			expect(() => kv.setMax('kv-key', value)).toThrow(RangeError);
			expect(kv['store'].get).not.toHaveBeenCalled();
			expect(kv.set).not.toHaveBeenCalled();
		},
	);

	test('Returns false if existing value is bigger than passed value', async () => {
		const mockKey = 'kv-key';
		const mockValue = 42;
		const mockStoredValue = 500;

		vi.mocked(kv['store'].get).mockReturnValue(new Uint8Array([1]));
		vi.mocked(deserialize).mockReturnValue(mockStoredValue);
		kv.set = vi.fn();

		const result = await kv.setMax(mockKey, mockValue);

		expect(kv.set).not.toHaveBeenCalled();
		expect(result).toBe(false);
	});

	test('Returns false if existing value equals passed value', async () => {
		const mockKey = 'kv-key';
		const mockValue = 42;

		vi.mocked(kv['store'].get).mockReturnValue(new Uint8Array([1]));
		vi.mocked(deserialize).mockReturnValue(mockValue);
		kv.set = vi.fn();

		const result = await kv.setMax(mockKey, mockValue);

		expect(kv.set).not.toHaveBeenCalled();
		expect(result).toBe(false);
	});

	test('Returns true if passed value is bigger than existing value', async () => {
		const mockKey = 'kv-key';
		const mockValue = 500;
		const mockStoredValue = 42;

		vi.mocked(kv['store'].get).mockReturnValue(new Uint8Array([1]));
		vi.mocked(deserialize).mockReturnValue(mockStoredValue);
		kv.set = vi.fn();

		const result = await kv.setMax(mockKey, mockValue);

		expect(kv.set).toHaveBeenCalledWith(mockKey, mockValue);
		expect(result).toBe(true);
	});
});

describe('delete', () => {
	test('Deletes key from store', async () => {
		const mockKey = 'kv-key';

		await kv.delete(mockKey);

		expect(kv['store'].delete).toHaveBeenCalledWith(mockKey);
	});
});

describe('has', () => {
	test('Returns result of lru has', async () => {
		const mockKey = 'kv-key';

		vi.mocked(kv['store'].has).mockReturnValue(false);

		const res1 = await kv.has(mockKey);

		expect(kv['store'].has).toHaveBeenCalledWith(mockKey);
		expect(res1).toBe(false);

		vi.mocked(kv['store'].has).mockReturnValue(true);

		const res2 = await kv.has(mockKey);

		expect(kv['store'].has).toHaveBeenCalledWith(mockKey);
		expect(res2).toBe(true);
	});
});

describe('acquireLock', () => {
	test('Hands the lock to one holder at a time, in order of asking', async () => {
		const first = await kv.acquireLock('key');
		const secondSettled = vi.fn();

		const second = kv.acquireLock('key').then((lock) => {
			// Records the moment the second caller got in, so the test can tell "waiting" from "held"
			secondSettled();
			return lock;
		});

		await Promise.resolve();
		expect(secondSettled).not.toHaveBeenCalled();

		await first.release();
		const lock = await second;
		expect(secondSettled).toHaveBeenCalledOnce();

		// `extend` has nothing to do locally; releasing the last holder forgets the key
		await expect(lock.extend(100)).resolves.toBeUndefined();
		await lock.release();
		expect(kv['locks'].has('key')).toBe(false);
	});

	test('Gives up after lockTimeout and lets the callers behind it through', async () => {
		vi.useFakeTimers();

		try {
			// A holder that never releases: the next caller fails after the budget, with the key in the message
			const impatient = new KvDriverLocal({ lockTimeout: 1000 });
			const holder = await impatient.acquireLock('key');

			const waiting = impatient.acquireLock('key');
			const settled = waiting.catch((error: unknown) => error);

			await vi.advanceTimersByTimeAsync(1000);
			expect(await settled).toMatchObject({ message: 'Lock "key" was not acquired within 1000 ms' });

			// A caller behind the one that gave up still waits for the holder, and gets in as soon as it releases — the
			// abandoned slot does not hold it up
			const behind = impatient.acquireLock('key');
			const behindSettled = vi.fn();
			void behind.then(behindSettled);

			await vi.advanceTimersByTimeAsync(0);
			expect(behindSettled).not.toHaveBeenCalled();

			await holder.release();
			await vi.advanceTimersByTimeAsync(0);
			expect(behindSettled).toHaveBeenCalledOnce();
			await (await behind).release();

			// Waiters that gave up, in whatever number and order, leave no entry behind once the holder releases
			const again = await impatient.acquireLock('key');
			const quitters = [impatient.acquireLock('key').catch(() => {}), impatient.acquireLock('key').catch(() => {})];
			await vi.advanceTimersByTimeAsync(1000);
			await Promise.all(quitters);
			expect(impatient['locks'].has('key')).toBe(true);
			await again.release();
			expect(impatient['locks'].has('key')).toBe(false);

			// A second release of the same handle changes nothing
			await again.release();
			expect(impatient['locks'].has('key')).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	test('Refuses a lock timeout a timer cannot hold', () => {
		// `NaN`, a negative budget and infinity would make every `acquireLock` misbehave
		expect(() => new KvDriverLocal({ lockTimeout: Number.NaN })).toThrow(InvalidConfigError);
		expect(() => new KvDriverLocal({ lockTimeout: -1 })).toThrow(InvalidConfigError);
		expect(() => new KvDriverLocal({ lockTimeout: Number.POSITIVE_INFINITY })).toThrow(InvalidConfigError);
	});

	test('Keeps locks of different keys independent', async () => {
		// Key isolation is asserted on the driver's own record rather than by the absence of a timeout
		const a = await kv.acquireLock('a');
		const b = await kv.acquireLock('b');

		expect(kv['locks'].size).toBe(2);

		await a.release();
		expect(kv['locks'].size).toBe(1);

		await b.release();
		expect(kv['locks'].size).toBe(0);
	});
});

describe('usingLock', () => {
	test('Runs the callback under the lock and answers with its result', async () => {
		const callback = vi.fn().mockResolvedValue('result');
		const result = await kv.usingLock('key', callback);
		expect(callback).toHaveBeenCalled();
		expect(result).toBe('result');
		expect(kv['locks'].has('key')).toBe(false);
	});

	test('Serialises callbacks on the same key and releases after a throwing one', async () => {
		const order: string[] = [];

		await Promise.all([
			kv.usingLock('key', async () => {
				// Yields to the event loop while holding, so a lock that did not serialise would let the second one in
				// between its two entries
				order.push('a:in');
				await new Promise((resolve) => setTimeout(resolve, 10));
				order.push('a:out');
			}),
			kv.usingLock('key', async () => {
				// Instant, yet its entries must still come after the first one's
				order.push('b:in');
				order.push('b:out');
			}),
		]);

		expect(order).toStrictEqual(['a:in', 'a:out', 'b:in', 'b:out']);

		// A callback that throws still lets the next one in
		await expect(
			kv.usingLock('key', async () => {
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');

		await expect(kv.usingLock('key', async () => 'after')).resolves.toBe('after');
	});
});

describe('clear', () => {
	test('Clears the store', async () => {
		await kv.clear();
		expect(kv['store'].clear).toHaveBeenCalled();
	});
});
