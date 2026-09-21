/**
 * Tests of `memory/kv/lib/drivers/local`.
 */
import { LRUCache } from 'lru-cache';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { deserialize, serialize } from '../../../utils/index.js';
import { KvDriverLocal } from './local.js';

vi.mock('lru-cache');
vi.mock('../../../utils/index.js');

let kv: KvDriverLocal;

beforeEach(() => {
	// 1. `lru-cache` is automocked, so the store built here already answers with mock functions
	kv = new KvDriverLocal({ maxKeys: 2 });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Instantiates LRU cache with configuration', () => {
		expect(LRUCache).toHaveBeenCalledWith({
			max: 2,
		});
	});

	test('Defaults to JS map if LRU config is not set', () => {
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

	test('Sets value to existing + passed amount if no value exists', async () => {
		const mockKey = 'kv-key';
		const mockValue = 42;
		const mockAmount = 15;

		vi.mocked(kv['store'].get).mockReturnValue(new Uint8Array([1]));
		vi.mocked(deserialize).mockReturnValue(mockValue);
		kv.set = vi.fn();

		await kv.increment(mockKey, mockAmount);

		expect(kv.set).toHaveBeenCalledWith(mockKey, mockValue + mockAmount);
	});

	test('Errors if key does not contain number', async () => {
		const mockKey = 'kv-key';
		const mockStoredValue = 'not-a-number';

		vi.mocked(kv['store'].get).mockReturnValue(new Uint8Array([1]));
		vi.mocked(deserialize).mockReturnValue(mockStoredValue);

		expect(() => kv.increment(mockKey)).toThrowErrorMatchingInlineSnapshot(
			'[Error: The value for key "kv-key" is not a number.]',
		);
	});
});

describe('setMax', () => {
	test('Errors if key does not contain number', async () => {
		const mockKey = 'kv-key';
		const mockValue = 42;
		const mockStoredValue = 'not-a-number';

		vi.mocked(kv['store'].get).mockReturnValue(new Uint8Array([1]));
		vi.mocked(deserialize).mockReturnValue(mockStoredValue);

		expect(() => kv.setMax(mockKey, mockValue)).toThrowErrorMatchingInlineSnapshot(
			'[Error: The value for key "kv-key" is not a number.]',
		);
	});

	test('Defaults to 0 if current value does not exist', async () => {
		const mockKey = 'kv-key';
		const mockValue = 42;

		kv.set = vi.fn();

		await kv.setMax(mockKey, mockValue);

		expect(kv.set).toHaveBeenCalledWith(mockKey, mockValue);
	});

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
		// 1. The first caller holds the lock at once; the second waits until the first releases
		const first = await kv.acquireLock('key');
		const secondSettled = vi.fn();

		const second = kv.acquireLock('key').then((lock) => {
			secondSettled();
			return lock;
		});

		await Promise.resolve();
		expect(secondSettled).not.toHaveBeenCalled();

		await first.release();
		const lock = await second;
		expect(secondSettled).toHaveBeenCalledOnce();

		// 2. `extend` has nothing to do locally; releasing the last holder forgets the key
		await expect(lock.extend(100)).resolves.toBeUndefined();
		await lock.release();
		expect(kv['locks'].has('key')).toBe(false);
	});

	test('Keeps locks of different keys independent', async () => {
		const a = await kv.acquireLock('a');
		const b = await kv.acquireLock('b');

		await a.release();
		await b.release();
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
		// 1. Two callbacks race for the key; the second starts only once the first is done
		const order: string[] = [];

		await Promise.all([
			kv.usingLock('key', async () => {
				order.push('a:in');
				await new Promise((resolve) => setTimeout(resolve, 10));
				order.push('a:out');
			}),
			kv.usingLock('key', async () => {
				order.push('b:in');
				order.push('b:out');
			}),
		]);

		expect(order).toStrictEqual(['a:in', 'a:out', 'b:in', 'b:out']);

		// 2. A callback that throws still lets the next one in
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
