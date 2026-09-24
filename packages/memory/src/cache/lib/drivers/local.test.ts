/**
 * Tests of `memory/cache/lib/drivers/local`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Lock } from '../../../kv/index.js';
import { KvDriverLocal } from '../../../kv/index.js';
import { CacheDriverLocal } from './local.js';

vi.mock('../../../kv/index.js');
vi.mock('../../../utils/index.js');

/**
 * Key every test reads or writes; the automocked store records the calls, so one key is all the tests need.
 */
const mockKey = 'test-key';

/**
 * Value the tests hand in and expect back; a string, since the cache passes any value through unchanged.
 */
const mockValue = 'test-value';

let cache: CacheDriverLocal;

beforeEach(() => {
	// 1. The Kv store is automocked, so every method of `cache['store']` is a mock the tests configure and assert on
	cache = new CacheDriverLocal({ maxKeys: 2 });
});

afterEach(() => {
	// 1. Calls are cleared, not the implementations, so a `mockResolvedValue` of one test does not leak into the next
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Instantiates Kv with configuration', () => {
		// 1. The config goes to the store unchanged: the cache has no options of its own
		expect(KvDriverLocal).toHaveBeenCalledWith({ maxKeys: 2 });

		expect(cache['store']).toBeInstanceOf(KvDriverLocal);
	});

	test('Hands the lock timeout to the store', () => {
		// 1. The cache exposes the store's locks, so it has to take the store's budget for them too
		new CacheDriverLocal({ maxKeys: 2, lockTimeout: 1000 });

		expect(KvDriverLocal).toHaveBeenLastCalledWith({ maxKeys: 2, lockTimeout: 1000 });
	});
});

describe('get', () => {
	test('Returns result of store get', async () => {
		// 1. The store's synchronous answer comes back through the async cache API
		vi.mocked(cache['store'].get).mockResolvedValue(mockValue);

		const res = await cache.get(mockKey);

		expect(res).toBe(mockValue);
	});
});

describe('set', () => {
	test('Sets the value to the kv store', async () => {
		// 1. The value is handed over as is; serializing it is the store's job
		await cache.set(mockKey, mockValue);

		expect(cache['store'].set).toHaveBeenCalledWith(mockKey, mockValue);
	});
});

describe('delete', () => {
	test('Deletes key from kv store', async () => {
		// 1. A single process holds no second copy, so the store's delete is the whole operation
		await cache.delete(mockKey);

		expect(cache['store'].delete).toHaveBeenCalledWith(mockKey);
	});
});

describe('has', () => {
	test('Returns result of kv store has', async () => {
		// 1. The store's probe answers; the cache adds no bookkeeping of its own
		vi.mocked(cache['store'].has).mockResolvedValue(true);

		const res = await cache.has(mockKey);

		expect(res).toBe(true);
	});
});

describe('clear', () => {
	test('Clears the kv store', async () => {
		// 1. The store owns the LRU, so emptying it empties the cache
		await cache.clear();
		expect(cache['store'].clear).toHaveBeenCalled();
	});
});

describe('acquireLock', () => {
	test('Acquires lock from kv store', async () => {
		// 1. The handle is the store's own, handed through untouched
		const mockLock: Lock = { release: vi.fn(), extend: vi.fn() };
		vi.mocked(cache['store'].acquireLock).mockResolvedValue(mockLock);

		const res = await cache.acquireLock(mockKey);
		expect(cache['store'].acquireLock).toHaveBeenCalledWith(mockKey);
		expect(res).toBe(mockLock);
	});
});

describe('usingLock', () => {
	test('Uses lock from kv store', async () => {
		// 1. The callback and its result travel through the store's `usingLock` unchanged
		const mockCallback = vi.fn().mockResolvedValue('result');
		vi.mocked(cache['store'].usingLock).mockResolvedValue('result');

		const res = await cache.usingLock(mockKey, mockCallback);
		expect(cache['store'].usingLock).toHaveBeenCalledWith(mockKey, mockCallback);
		expect(res).toBe('result');
	});
});
