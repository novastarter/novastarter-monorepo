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

/**
 * L1 options; a size limit alone, so the tests that derive the ttl from L2 start from a local config without one.
 */
const mockLocalConfig = {
	maxKeys: 5,
};

/**
 * L2 options: the namespace and the automocked client the bus is expected to share.
 */
const mockRedisConfig = {
	namespace: 'test',
	redis: new Redis(),
};

/**
 * Key every test reads, writes or invalidates.
 */
const mockKey = 'mock-key';

/**
 * Value the writes carry; a number, since the levels take any value and only the calls are asserted.
 */
const mockValue = 15;

/**
 * What L1 answers by default, so a read that stops at L1 can be told from one that fell through.
 */
const mockLocalValue = 'mock-local-value';

/**
 * What L2 answers by default; distinct from the L1 value for the same reason.
 */
const mockRedisValue = 'mock-redis-value';

beforeEach(() => {
	// 1. The automocked bus answers `undefined`; the driver keeps the subscription promise, so it has to be one
	vi.mocked(BusDriverRedis.prototype.subscribe).mockResolvedValue(undefined);
	vi.mocked(BusDriverRedis.prototype.close).mockResolvedValue(undefined);

	// 2. Both levels are automocked, so the cache under test is the coordination between them and the bus
	cache = new CacheDriverMulti({
		local: mockLocalConfig,
		redis: mockRedisConfig,
	});

	vi.mocked(cache['local'].get).mockResolvedValue(mockLocalValue);
	vi.mocked(cache['redis'].get).mockResolvedValue(mockRedisValue);
});

afterEach(() => {
	// 1. Calls are cleared, not the implementations, so a `mockResolvedValue` of one test does not leak into the next
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Creates local and redis cache handlers', async () => {
		// 1. Each level gets its own config; without a ttl on L2 the L1 config goes through as it was
		expect(CacheDriverLocal).toBeCalledWith(mockLocalConfig);
		expect(cache['local']).toBeInstanceOf(CacheDriverLocal);

		expect(CacheDriverRedis).toBeCalledWith(mockRedisConfig);
		expect(cache['redis']).toBeInstanceOf(CacheDriverRedis);
	});

	test('Creates a redis bus over the L2 connection and namespace', () => {
		// 1. The invalidations travel on the same server and namespace as the values they concern
		expect(BusDriverRedis).toHaveBeenCalledWith({ redis: mockRedisConfig.redis, namespace: mockRedisConfig.namespace });
		expect(cache['bus']).toBeInstanceOf(BusDriverRedis);
	});

	test('Gives L1 the ttl of L2 when it has none of its own', () => {
		// 1. L2 expiry never reaches L1 — only writes publish invalidations — so an L1 without a ttl would serve a key
		//    L2 already lost, in the process that wrote it, until eviction
		new CacheDriverMulti({ local: mockLocalConfig, redis: { ...mockRedisConfig, ttl: 60_000 } });

		expect(CacheDriverLocal).toHaveBeenLastCalledWith({ maxKeys: 5, ttl: 60_000 });
	});

	test('Keeps a shorter L1 ttl and refuses a longer one', () => {
		// 1. A shorter L1 ttl is a valid choice: memory turns over faster than Redis
		new CacheDriverMulti({ local: { maxKeys: 5, ttl: 1_000 }, redis: { ...mockRedisConfig, ttl: 60_000 } });

		expect(CacheDriverLocal).toHaveBeenLastCalledWith({ maxKeys: 5, ttl: 1_000 });

		// 2. A longer one would outlive L2, so it is refused at construction rather than served stale later
		expect(
			() => new CacheDriverMulti({ local: { maxKeys: 5, ttl: 61_000 }, redis: { ...mockRedisConfig, ttl: 60_000 } }),
		).toThrow(RangeError);

		// 3. Without an L2 ttl any L1 ttl goes, since L2 keeps the key for good
		expect(() => new CacheDriverMulti({ local: { maxKeys: 5, ttl: 61_000 }, redis: mockRedisConfig })).not.toThrow();
	});
});

describe('get', () => {
	test('Returns local value if exists', async () => {
		// 1. A memory hit spares the Redis round trip
		const result = await cache.get(mockKey);
		expect(cache['local'].get).toHaveBeenCalledWith(mockKey);
		expect(result).toBe(mockLocalValue);
	});

	test('Returns redis value if local is undefined', async () => {
		// 1. A miss falls through to L2; the value is not promoted into L1, only writes populate it
		vi.mocked(cache['local'].get).mockResolvedValue(undefined);
		const result = await cache.get(mockKey);
		expect(cache['local'].get).toHaveBeenCalledWith(mockKey);
		expect(cache['redis'].get).toHaveBeenCalledWith(mockKey);
		expect(result).toBe(mockRedisValue);
		expect(cache['local'].set).not.toHaveBeenCalled();
	});
});

describe('set', () => {
	test('Writes L2 first and L1 only once L2 took the value', async () => {
		// 1. Both levels get the value on a successful write
		await cache.set(mockKey, mockValue);
		expect(cache['local'].set).toHaveBeenCalledWith(mockKey, mockValue);
		expect(cache['redis'].set).toHaveBeenCalledWith(mockKey, mockValue);

		// 2. A Redis that refuses the write leaves L1 untouched: no value this process alone would serve
		vi.mocked(cache['redis'].set).mockRejectedValueOnce(new Error('READONLY'));
		vi.mocked(cache['local'].set).mockClear();

		await expect(cache.set(mockKey, 'other')).rejects.toThrow('READONLY');
		expect(cache['local'].set).not.toHaveBeenCalled();

		// 3. And leaves no write counted as under way, so the next one starts clean
		expect(cache['writing'].size).toBe(0);
	});

	test('Keeps a write out of L1 when another process invalidated the key while it was in flight', async () => {
		// 1. The L2 write is held pending, the way a reply still on the wire is
		let settle!: () => void;
		vi.mocked(cache['redis'].set).mockReturnValueOnce(new Promise<void>((resolve) => (settle = resolve)));

		const write = cache.set(mockKey, mockValue);
		await Promise.resolve();
		expect(cache['writing'].get(mockKey)).toStrictEqual({ count: 1, invalidated: false });

		// 2. Another process's invalidation for the key arrives on the bus meanwhile: L1 is dropped, as always, and
		//    the pending write is marked
		const onMessage = vi.mocked(cache['bus'].subscribe).mock.calls[0]![1];
		await onMessage({ type: 'clear', origin: 'other-process', key: mockKey });
		expect(cache['local'].delete).toHaveBeenCalledWith(mockKey);

		// 3. Once L2 answers, the value stays out of L1 — it may be older than what L2 holds now — while the
		//    invalidation is still published for the others, and the key is no longer counted as under way
		settle();
		await write;

		expect(cache['local'].set).not.toHaveBeenCalled();
		expect(cache['bus'].publish).toHaveBeenCalledWith(CACHE_CHANNEL_KEY, expect.objectContaining({ key: mockKey }));
		expect(cache['writing'].size).toBe(0);

		// 4. The next write of the key starts clean and lands in L1 again
		await cache.set(mockKey, mockValue);
		expect(cache['local'].set).toHaveBeenCalledWith(mockKey, mockValue);
	});

	test('Marks every in-flight write when the invalidation carries no key, and none for another key', async () => {
		// 1. Two writes of different keys pending at once
		const settles: (() => void)[] = [];

		vi.mocked(cache['redis'].set).mockImplementation(() => new Promise<void>((resolve) => settles.push(resolve)));

		const first = cache.set(mockKey, mockValue);
		const second = cache.set('other-key', mockValue);
		await Promise.resolve();

		// 2. An invalidation of a third key touches neither; a `clear` of everything marks both
		const onMessage = vi.mocked(cache['bus'].subscribe).mock.calls[0]![1];
		await onMessage({ type: 'clear', origin: 'other-process', key: 'third-key' });
		expect(cache['writing'].get(mockKey)).toStrictEqual({ count: 1, invalidated: false });
		expect(cache['writing'].get('other-key')).toStrictEqual({ count: 1, invalidated: false });

		await onMessage({ type: 'clear', origin: 'other-process' });
		expect(cache['local'].clear).toHaveBeenCalledOnce();
		expect(cache['writing'].get(mockKey)).toStrictEqual({ count: 1, invalidated: true });
		expect(cache['writing'].get('other-key')).toStrictEqual({ count: 1, invalidated: true });

		// 3. Neither write reaches L1
		settles.forEach((settle) => settle());
		await Promise.all([first, second]);

		expect(cache['local'].set).not.toHaveBeenCalled();
		expect(cache['writing'].size).toBe(0);
	});

	test('Ignores its own invalidation for an in-flight write', async () => {
		// 1. A message stamped with this process's id is one of its own, already accounted for; it must not keep a
		//    concurrent write of the same process out of L1
		let settle!: () => void;
		vi.mocked(cache['redis'].set).mockReturnValueOnce(new Promise<void>((resolve) => (settle = resolve)));

		const write = cache.set(mockKey, mockValue);
		await Promise.resolve();

		const onMessage = vi.mocked(cache['bus'].subscribe).mock.calls[0]![1];
		await onMessage({ type: 'clear', origin: cache['processId'], key: mockKey });

		settle();
		await write;

		expect(cache['local'].set).toHaveBeenCalledWith(mockKey, mockValue);
	});
});

describe('delete', () => {
	test('Deletes from L2 first, then L1, and tells the other processes', async () => {
		// 1. Both levels drop the key on a successful delete
		await cache.delete(mockKey);
		expect(cache['local'].delete).toHaveBeenCalledWith(mockKey);
		expect(cache['redis'].delete).toHaveBeenCalledWith(mockKey);

		// 2. L2 first, like `set`: a failed L2 delete leaves L1 as a copy of what L2 still holds
		vi.mocked(cache['redis'].delete).mockRejectedValueOnce(new Error('READONLY'));
		vi.mocked(cache['local'].delete).mockClear();

		await expect(cache.delete(mockKey)).rejects.toThrow('READONLY');
		expect(cache['local'].delete).not.toHaveBeenCalled();
	});

	test('Keeps an in-flight set of the same key out of L1', async () => {
		// 1. A `set` waits for its L2 reply; a concurrent `delete` of the same process removes the key from both
		//    levels, but the set would still land in L1 afterwards — the sender skips its own invalidation messages —
		//    with L2 holding nothing and no further invalidation coming
		let settle!: () => void;
		vi.mocked(cache['redis'].set).mockReturnValueOnce(new Promise<void>((resolve) => (settle = resolve)));

		const write = cache.set(mockKey, mockValue);
		await Promise.resolve();

		await cache.delete(mockKey);
		settle();
		await write;

		// 2. The delete ran, and the late write stayed out of L1
		expect(cache['redis'].delete).toHaveBeenCalledWith(mockKey);
		expect(cache['local'].delete).toHaveBeenCalledWith(mockKey);
		expect(cache['local'].set).not.toHaveBeenCalled();
		expect(cache['writing'].size).toBe(0);
	});
});

describe('invalidation over the bus', () => {
	test('Subscribes to the cache channel at construction and publishes a stamped clear message on every write', async () => {
		// 1. The contract the other processes rely on: channel, message shape and the origin that lets a sender skip its own
		expect(cache['bus'].subscribe).toHaveBeenCalledWith(CACHE_CHANNEL_KEY, expect.any(Function));

		await cache.set(mockKey, mockValue);

		expect(cache['bus'].publish).toHaveBeenLastCalledWith(CACHE_CHANNEL_KEY, {
			type: 'clear',
			key: mockKey,
			origin: cache['processId'],
		});

		// 2. A delete announces the same key; a clear announces no key, which means every key
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
		// 1. The callback given to the bus is what applies another process's invalidation to L1
		const callback = vi.mocked(cache['bus'].subscribe).mock.calls[0]![1];

		await callback({ type: 'clear', origin: 'other-process', key: mockKey });
		expect(cache['local'].delete).toHaveBeenCalledWith(mockKey);
	});

	test('Drops the whole L1 and keeps in-flight writes out of it after the bus reconnected', async () => {
		// 1. Invalidations sent while the subscriber was down are lost, so any L1 key may be stale after a reconnect
		const reconnect = vi.mocked(cache['bus'].onReconnect!).mock.calls[0]![0];

		let settle!: () => void;
		vi.mocked(cache['redis'].set).mockReturnValueOnce(new Promise<void>((resolve) => (settle = resolve)));

		const pending = cache.set(mockKey, mockValue);
		await vi.waitFor(() => expect(cache['redis'].set).toHaveBeenCalled());

		await reconnect();

		expect(cache['local'].clear).toHaveBeenCalledOnce();

		// 2. The write in flight during the reconnect may predate a missed invalidation, so it skips L1
		settle();
		await pending;

		expect(cache['local'].set).not.toHaveBeenCalled();
	});
});

describe('has', () => {
	test('Checks if redis has the value cached', async () => {
		// 1. L2 is the source of truth: a key missing from this process's L1 may be cached elsewhere
		vi.mocked(cache['redis'].has).mockResolvedValue(true);
		const result = await cache.has(mockKey);
		expect(cache['redis'].has).toHaveBeenCalledWith(mockKey);
		expect(result).toBe(true);
	});
});

describe('acquireLock', () => {
	test('Delegates to redis cache', async () => {
		// 1. Only the Redis lock is visible to other processes; the handle is handed through untouched
		const mockLock = { release: vi.fn(), extend: vi.fn() };
		vi.mocked(cache['redis'].acquireLock).mockResolvedValue(mockLock as any);

		const result = await cache.acquireLock(mockKey);
		expect(cache['redis'].acquireLock).toHaveBeenCalledWith(mockKey);
		expect(result).toBe(mockLock);
	});
});

describe('usingLock', () => {
	test('Delegates to redis cache', async () => {
		// 1. The callback and its result travel through L2's `usingLock` unchanged
		const mockCallback = vi.fn().mockResolvedValue('result');
		vi.mocked(cache['redis'].usingLock).mockResolvedValue('result');

		const result = await cache.usingLock(mockKey, mockCallback);
		expect(cache['redis'].usingLock).toHaveBeenCalledWith(mockKey, mockCallback);
		expect(result).toBe('result');
	});
});

describe('clear', () => {
	test('Calls clear for both caches', async () => {
		// 1. Both levels are emptied; the return value carries nothing
		const result = await cache.clear();
		expect(cache['local'].clear).toHaveBeenCalledOnce();
		expect(cache['redis'].clear).toHaveBeenCalledOnce();
		expect(result).toBeUndefined();
	});

	test('Keeps in-flight sets of this process out of L1', async () => {
		// 1. Two writes of different keys wait for their L2 replies while a `clear` of the same process runs: like a
		//    keyless invalidation of another process, it marks every in-flight write to skip L1 — the sender skips its
		//    own messages, so without the mark each write would repopulate L1 after everything was cleared
		const settles: (() => void)[] = [];
		vi.mocked(cache['redis'].set).mockImplementation(() => new Promise<void>((resolve) => settles.push(resolve)));

		const first = cache.set(mockKey, mockValue);
		const second = cache.set('other-key', mockValue);
		await Promise.resolve();

		await cache.clear();
		settles.forEach((settle) => settle());
		await Promise.all([first, second]);

		// 2. The clear ran, and neither late write reached L1
		expect(cache['local'].clear).toHaveBeenCalledOnce();
		expect(cache['local'].set).not.toHaveBeenCalled();
		expect(cache['writing'].size).toBe(0);
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
		// 1. L2 runs on the caller's connection and L1 holds nothing, so the subscriber connection is all there is to quit
		await cache.close();

		expect(cache['bus'].close).toHaveBeenCalledOnce();
	});

	test('Refuses a write after close instead of filling an L1 nobody invalidates any more', async () => {
		// 1. With the bus gone no invalidation can reach this process, so a write is refused before touching a level
		await cache.close();

		await expect(cache.set(mockKey, mockValue)).rejects.toThrow('The multi cache is closed');
		expect(cache['local'].set).not.toHaveBeenCalled();
		expect(cache['bus'].publish).not.toHaveBeenCalled();

		// 2. Reads still answer from what is cached
		await expect(cache.get(mockKey)).resolves.toBe(mockLocalValue);
	});
});

describe('onMessageClear', () => {
	test('Ignores messages from self', async () => {
		// 1. `set` and `delete` already updated L1 before publishing; dropping the key again would throw away fresh data
		await cache['onMessageClear']({
			type: 'clear',
			origin: cache['processId'],
		});

		expect(cache['local'].delete).not.toHaveBeenCalled();
		expect(cache['local'].clear).not.toHaveBeenCalled();
	});

	test('Clears specific key if provided in payload', async () => {
		// 1. A keyed message drops that key alone
		await cache['onMessageClear']({
			type: 'clear',
			origin: 'other-process',
			key: mockKey,
		});

		expect(cache['local'].delete).toHaveBeenCalledWith(mockKey);
		expect(cache['local'].clear).not.toHaveBeenCalled();
	});

	test('Clears all keys if key is undefined', async () => {
		// 1. A message without a key is another process's `clear()`, so everything local goes
		await cache['onMessageClear']({
			type: 'clear',
			origin: 'other-process',
		});

		expect(cache['local'].delete).not.toHaveBeenCalled();
		expect(cache['local'].clear).toHaveBeenCalled();
	});
});
