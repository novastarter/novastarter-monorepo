/**
 * Tests of `memory/cache/lib/drivers/redis`.
 */
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Lock } from '../../../kv/index.js';
import { KvDriverRedis } from '../../../kv/index.js';
import { CacheDriverRedis } from './redis.js';

vi.mock('ioredis');
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

/**
 * Namespace the cache is built with, asserted on the store's constructor call.
 */
const mockNamespace = 'test-namespace';

let mockRedis: Redis;
let cache: CacheDriverRedis;

beforeEach(() => {
	// 1. Both ioredis and the Kv store are automocked, so the cache is built on doubles and every store method is a mock
	mockRedis = new Redis();
	cache = new CacheDriverRedis({ namespace: mockNamespace, redis: mockRedis });
});

afterEach(() => {
	// 1. Calls are cleared, not the implementations, so a `mockResolvedValue` of one test does not leak into the next
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Instantiates Kv with configuration', () => {
		// 1. The config goes to the store unchanged: the cache has no options of its own
		expect(KvDriverRedis).toHaveBeenCalledWith({ redis: mockRedis, namespace: mockNamespace });

		expect(cache['store']).toBeInstanceOf(KvDriverRedis);
	});

	test('Hands the lock timeout to the store', () => {
		// 1. The cache exposes the store's locks, so it has to take the store's budget for them too
		new CacheDriverRedis({ namespace: mockNamespace, redis: mockRedis, lockTimeout: 1000 });

		expect(KvDriverRedis).toHaveBeenLastCalledWith({ namespace: mockNamespace, redis: mockRedis, lockTimeout: 1000 });
	});
});

describe('get', () => {
	test('Returns result of store get', async () => {
		// 1. The store reads, gunzips and parses; its answer comes back as is
		vi.mocked(cache['store'].get).mockResolvedValue(mockValue);

		const res = await cache.get(mockKey);

		expect(res).toBe(mockValue);
	});
});

describe('set', () => {
	test('Sets the value to the kv store', async () => {
		// 1. The value is handed over as is; serializing, compressing and expiring it is the store's job
		await cache.set(mockKey, mockValue);

		expect(cache['store'].set).toHaveBeenCalledWith(mockKey, mockValue);
	});
});

describe('delete', () => {
	test('Deletes key from kv store', async () => {
		// 1. This cache holds no local copy, so the store's unlink is the whole operation
		await cache.delete(mockKey);

		expect(cache['store'].delete).toHaveBeenCalledWith(mockKey);
	});
});

describe('has', () => {
	test('Returns result of kv store has', async () => {
		// 1. The store's `EXISTS` round trip answers; the cache adds no bookkeeping of its own
		vi.mocked(cache['store'].has).mockResolvedValue(true);

		const res = await cache.has(mockKey);

		expect(res).toBe(true);
	});
});

describe('clear', () => {
	test('Clears the kv store', async () => {
		// 1. The store scans and unlinks its namespace, which is the cache's namespace
		await cache.clear();
		expect(cache['store'].clear).toHaveBeenCalled();
	});
});

describe('acquireLock', () => {
	test('Delegates to kv store', async () => {
		// 1. The handle is the store's Redlock one, handed through untouched
		const mockLock: Lock = { release: vi.fn(), extend: vi.fn() };
		vi.mocked(cache['store'].acquireLock).mockResolvedValue(mockLock);

		const result = await cache.acquireLock(mockKey);
		expect(cache['store'].acquireLock).toHaveBeenCalledWith(mockKey);
		expect(result).toBe(mockLock);
	});
});

describe('usingLock', () => {
	test('Delegates to kv store', async () => {
		// 1. The callback and its result travel through the store's `usingLock` unchanged
		const mockCallback = vi.fn().mockResolvedValue('result');
		vi.mocked(cache['store'].usingLock).mockResolvedValue('result');

		const result = await cache.usingLock(mockKey, mockCallback);
		expect(cache['store'].usingLock).toHaveBeenCalledWith(mockKey, mockCallback);
		expect(result).toBe('result');
	});
});
