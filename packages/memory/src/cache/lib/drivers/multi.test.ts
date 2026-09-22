/**
 * Tests of `memory/cache/lib/drivers/multi`.
 */
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BusDriverRedis } from '../../../bus/index.js';
import { CacheDriverLocal } from './local.js';
import { CACHE_CHANNEL_KEY, CacheDriverMulti } from './multi.js';
import { CacheDriverRedis } from './redis.js';

vi.mock('../../../bus/index.js');
vi.mock('../../../utils/index.js');
vi.mock('./local.js');
vi.mock('./redis.js');
vi.mock('ioredis');

let cache: CacheDriverMulti;

const mockLocalConfig = {
	maxKeys: 5,
};

const mockRedisConfig = {
	namespace: 'test',
	redis: new Redis(),
};

const mockKey = 'mock-key';
const mockValue = 15;
const mockLocalValue = 'mock-local-value';
const mockRedisValue = 'mock-redis-value';

beforeEach(() => {
	// The automocked bus answers `undefined`; the driver keeps the subscription promise, so it has to be one
	vi.mocked(BusDriverRedis.prototype.subscribe).mockResolvedValue(undefined);
	vi.mocked(BusDriverRedis.prototype.close).mockResolvedValue(undefined);

	cache = new CacheDriverMulti({
		local: mockLocalConfig,
		redis: mockRedisConfig,
	});

	vi.mocked(cache['local'].get).mockResolvedValue(mockLocalValue);
	vi.mocked(cache['redis'].get).mockResolvedValue(mockRedisValue);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Creates local and redis cache handlers', async () => {
		expect(CacheDriverLocal).toBeCalledWith(mockLocalConfig);
		expect(cache['local']).toBeInstanceOf(CacheDriverLocal);

		expect(CacheDriverRedis).toBeCalledWith(mockRedisConfig);
		expect(cache['redis']).toBeInstanceOf(CacheDriverRedis);
	});

	test('Creates a redis bus over the L2 connection and namespace', () => {
		expect(BusDriverRedis).toHaveBeenCalledWith({ redis: mockRedisConfig.redis, namespace: mockRedisConfig.namespace });
		expect(cache['bus']).toBeInstanceOf(BusDriverRedis);
	});
});

describe('get', () => {
	test('Returns local value if exists', async () => {
		const result = await cache.get(mockKey);
		expect(cache['local'].get).toHaveBeenCalledWith(mockKey);
		expect(result).toBe(mockLocalValue);
	});

	test('Returns redis value if local is undefined', async () => {
		vi.mocked(cache['local'].get).mockResolvedValue(undefined);
		const result = await cache.get(mockKey);
		expect(cache['local'].get).toHaveBeenCalledWith(mockKey);
		expect(cache['redis'].get).toHaveBeenCalledWith(mockKey);
		expect(result).toBe(mockRedisValue);
	});
});

describe('set', () => {
	test('Writes L2 first and L1 only once L2 took the value', async () => {
		await cache.set(mockKey, mockValue);
		expect(cache['local'].set).toHaveBeenCalledWith(mockKey, mockValue);
		expect(cache['redis'].set).toHaveBeenCalledWith(mockKey, mockValue);

		// A Redis that refuses the write leaves L1 untouched: no value this process alone would serve
		vi.mocked(cache['redis'].set).mockRejectedValueOnce(new Error('READONLY'));
		vi.mocked(cache['local'].set).mockClear();

		await expect(cache.set(mockKey, 'other')).rejects.toThrow('READONLY');
		expect(cache['local'].set).not.toHaveBeenCalled();
	});
});

describe('delete', () => {
	test('Deletes from L2 first, then L1, and tells the other processes', async () => {
		await cache.delete(mockKey);
		expect(cache['local'].delete).toHaveBeenCalledWith(mockKey);
		expect(cache['redis'].delete).toHaveBeenCalledWith(mockKey);

		// L2 first, like `set`: a failed L2 delete leaves L1 as a copy of what L2 still holds
		vi.mocked(cache['redis'].delete).mockRejectedValueOnce(new Error('READONLY'));
		vi.mocked(cache['local'].delete).mockClear();

		await expect(cache.delete(mockKey)).rejects.toThrow('READONLY');
		expect(cache['local'].delete).not.toHaveBeenCalled();
	});
});

describe('invalidation over the bus', () => {
	test('Subscribes to the cache channel at construction and publishes a stamped clear message on every write', async () => {
		// The contract the other processes rely on: channel, message shape and the origin that lets a sender skip its own
		expect(cache['bus'].subscribe).toHaveBeenCalledWith(CACHE_CHANNEL_KEY, expect.any(Function));

		await cache.set(mockKey, mockValue);

		expect(cache['bus'].publish).toHaveBeenLastCalledWith(CACHE_CHANNEL_KEY, {
			type: 'clear',
			key: mockKey,
			origin: cache['processId'],
		});

		await cache.delete(mockKey);

		expect(cache['bus'].publish).toHaveBeenLastCalledWith(CACHE_CHANNEL_KEY, {
			type: 'clear',
			key: mockKey,
			origin: cache['processId'],
		});

		await cache.clear();

		expect(cache['bus'].publish).toHaveBeenLastCalledWith(CACHE_CHANNEL_KEY, {
			type: 'clear',
			key: undefined,
			origin: cache['processId'],
		});
	});

	test('Hands a message from the bus to onMessageClear', async () => {
		// The callback given to the bus is what applies another process's invalidation to L1
		const callback = vi.mocked(cache['bus'].subscribe).mock.calls[0]![1];

		await callback({ type: 'clear', origin: 'other-process', key: mockKey });
		expect(cache['local'].delete).toHaveBeenCalledWith(mockKey);
	});
});

describe('has', () => {
	test('Checks if redis has the value cached', async () => {
		vi.mocked(cache['redis'].has).mockResolvedValue(true);
		const result = await cache.has(mockKey);
		expect(cache['redis'].has).toHaveBeenCalledWith(mockKey);
		expect(result).toBe(true);
	});
});

describe('acquireLock', () => {
	test('Delegates to redis cache', async () => {
		const mockLock = { release: vi.fn(), extend: vi.fn() };
		vi.mocked(cache['redis'].acquireLock).mockResolvedValue(mockLock as any);

		const result = await cache.acquireLock(mockKey);
		expect(cache['redis'].acquireLock).toHaveBeenCalledWith(mockKey);
		expect(result).toBe(mockLock);
	});
});

describe('usingLock', () => {
	test('Delegates to redis cache', async () => {
		const mockCallback = vi.fn().mockResolvedValue('result');
		vi.mocked(cache['redis'].usingLock).mockResolvedValue('result');

		const result = await cache.usingLock(mockKey, mockCallback);
		expect(cache['redis'].usingLock).toHaveBeenCalledWith(mockKey, mockCallback);
		expect(result).toBe('result');
	});
});

describe('clear', () => {
	test('Calls clear for both caches', async () => {
		const result = await cache.clear();
		expect(cache['local'].clear).toHaveBeenCalledOnce();
		expect(cache['redis'].clear).toHaveBeenCalledOnce();
		expect(result).toBeUndefined();
	});
});

describe('subscription', () => {
	test('Reports a failed subscription on the next write and subscribes again there', async () => {
		const error = new Error('no subscriber connection');
		vi.mocked(BusDriverRedis.prototype.subscribe).mockRejectedValueOnce(error).mockRejectedValueOnce(error);

		// 1. Construction must not throw and must not leave an unhandled rejection behind
		const failed = new CacheDriverMulti({ local: mockLocalConfig, redis: mockRedisConfig });
		await Promise.resolve();

		// 2. The first write tries again, fails again, and reports it without writing or publishing: a key put into
		//    L1 by a process that receives no invalidations would go stale unseen. The automock records calls on the
		//    instance's method, so the assertions go through the driver's own bus
		await expect(failed.set(mockKey, mockValue)).rejects.toBe(error);
		expect(failed['bus'].subscribe).toHaveBeenCalledTimes(2);
		expect(failed['local'].set).not.toHaveBeenCalled();
		expect(failed['redis'].set).not.toHaveBeenCalled();
		expect(failed['bus'].publish).not.toHaveBeenCalled();

		// 3. Once Redis is back the next write subscribes, publishes and succeeds; later writes reuse the subscription
		vi.mocked(BusDriverRedis.prototype.subscribe).mockResolvedValue(undefined);
		await failed.set(mockKey, mockValue);
		await failed.delete(mockKey);

		expect(failed['bus'].subscribe).toHaveBeenCalledTimes(3);
		expect(failed['bus'].publish).toHaveBeenCalledTimes(2);
	});
});

describe('close', () => {
	test("Quits the bus, the one connection of the driver's own", async () => {
		await cache.close();

		expect(cache['bus'].close).toHaveBeenCalledOnce();
	});

	test('Refuses a write after close instead of filling an L1 nobody invalidates any more', async () => {
		await cache.close();

		await expect(cache.set(mockKey, mockValue)).rejects.toThrow('The multi cache is closed');
		expect(cache['local'].set).not.toHaveBeenCalled();
		expect(cache['bus'].publish).not.toHaveBeenCalled();

		// Reads still answer from what is cached
		await expect(cache.get(mockKey)).resolves.toBe(mockLocalValue);
	});
});

describe('onMessageClear', () => {
	test('Ignores messages from self', async () => {
		await cache['onMessageClear']({
			type: 'clear',
			origin: cache['processId'],
		});

		expect(cache['local'].delete).not.toHaveBeenCalled();
		expect(cache['local'].clear).not.toHaveBeenCalled();
	});

	test('Clears specific key if provided in payload', async () => {
		await cache['onMessageClear']({
			type: 'clear',
			origin: 'other-process',
			key: mockKey,
		});

		expect(cache['local'].delete).toHaveBeenCalledWith(mockKey);
		expect(cache['local'].clear).not.toHaveBeenCalled();
	});

	test('Clears all keys if key is undefined', async () => {
		await cache['onMessageClear']({
			type: 'clear',
			origin: 'other-process',
		});

		expect(cache['local'].delete).not.toHaveBeenCalled();
		expect(cache['local'].clear).toHaveBeenCalled();
	});
});
