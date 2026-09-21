/**
 * Tests of `memory/kv/lib/drivers/redis`.
 */
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
import { type ExtendedRedis, KvDriverRedis, SET_MAX_SCRIPT } from './redis.js';

vi.mock('ioredis');
vi.mock('../../../utils/index.js');

let mockNamespace: string;
let mockKey: string;
let mockNamespacedKey: string;
let mockRedis: Redis;
let mockUint8Array: Uint8Array;
let mockBuffer: Buffer;
let mockCompressedUint8Array: Uint8Array;
let mockDecompressedUint8Array: Uint8Array;
let mockValue: string;
let kv: KvDriverRedis;

beforeEach(() => {
	mockKey = 'test-key';
	mockNamespace = 'test';
	mockNamespacedKey = 'namespaced:test-key';

	mockUint8Array = new Uint8Array();
	mockBuffer = Buffer.from(mockUint8Array);
	mockCompressedUint8Array = new Uint8Array([1, 2, 3]);
	mockDecompressedUint8Array = new Uint8Array([1, 2, 3]);

	mockValue = 'test';

	mockRedis = new Redis();

	kv = new KvDriverRedis({
		namespace: mockNamespace,
		redis: mockRedis,
		compression: false,
	});

	vi.mocked(withNamespace).mockReturnValue(mockNamespacedKey);
	vi.mocked(bufferToUint8Array).mockReturnValue(mockUint8Array);
	vi.mocked(uint8ArrayToBuffer).mockReturnValue(mockBuffer as any);
	vi.mocked(compress).mockResolvedValue(mockCompressedUint8Array);
	vi.mocked(decompress).mockResolvedValue(mockDecompressedUint8Array);
	vi.mocked(serialize).mockReturnValue(mockUint8Array);
	vi.mocked(deserialize).mockReturnValue(mockValue);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Sets internal flags based on config', () => {
		expect(kv['redis']).toBe(mockRedis);
		expect(kv['namespace']).toBe(mockNamespace);
		expect(kv['compression']).toBe(false);
	});

	test('Defaults compression settings', () => {
		const kv = new KvDriverRedis({
			namespace: mockNamespace,
			redis: mockRedis,
		});

		expect(kv['compression']).toBe(true);
		expect(kv['compressionMinSize']).toBe(1000);
	});

	test('Defines redis setMax command if it does not exist yet', () => {
		expect(kv['redis'].defineCommand).toHaveBeenCalledWith('setMax', {
			numberOfKeys: 1,
			lua: SET_MAX_SCRIPT,
		});

		// Locks go through Redlock, which ships its own release script; no command of the driver's own
		expect(kv['redis'].defineCommand).toHaveBeenCalledOnce();
	});

	test('Skips defining the command if it already exists on redis', () => {
		const mockRedis = { defineCommand: vi.fn(), setMax: vi.fn() } as unknown as ExtendedRedis;

		new KvDriverRedis({ redis: mockRedis, namespace: mockNamespace, compression: false });

		expect(mockRedis.defineCommand).not.toHaveBeenCalled();
	});
});

describe('get', () => {
	test('Gets namespaced buffer', async () => {
		await kv.get(mockKey);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].getBuffer).toHaveBeenCalledWith(mockNamespacedKey);
	});

	test('Returns undefined for null values from Redis', async () => {
		vi.mocked(kv['redis'].getBuffer).mockResolvedValue(null);

		const result = await kv.get(mockKey);

		expect(result).toBe(undefined);
	});

	test('Returns deserialized buffer', async () => {
		vi.mocked(kv['redis'].getBuffer).mockResolvedValue(mockBuffer);

		const result = await kv.get(mockKey);

		expect(bufferToUint8Array).toHaveBeenCalledWith(mockBuffer);
		expect(deserialize).toHaveBeenCalledWith(mockUint8Array);
		expect(result).toBe(mockValue);
	});

	test('Decompresses value when compress has been set and value is gzip compressed', async () => {
		kv = new KvDriverRedis({
			namespace: mockNamespace,
			redis: mockRedis,
			compression: true,
		});

		vi.mocked(kv['redis'].getBuffer).mockResolvedValue(mockBuffer);

		vi.mocked(isCompressed).mockReturnValue(true);

		const result = await kv.get(mockKey);

		expect(bufferToUint8Array).toHaveBeenCalledWith(mockBuffer);
		expect(decompress).toHaveBeenCalledWith(mockUint8Array);
		expect(deserialize).toHaveBeenCalledWith(mockDecompressedUint8Array);
		expect(result).toBe(mockValue);
	});

	test('Skips decompression if compression is enabled but value is not compressed', async () => {
		kv = new KvDriverRedis({
			namespace: mockNamespace,
			redis: mockRedis,
			compression: true,
		});

		vi.mocked(kv['redis'].getBuffer).mockResolvedValue(mockBuffer);

		vi.mocked(isCompressed).mockReturnValue(false);

		const result = await kv.get(mockKey);

		expect(bufferToUint8Array).toHaveBeenCalledWith(mockBuffer);
		expect(decompress).not.toHaveBeenCalledWith(mockUint8Array);
		expect(deserialize).toHaveBeenCalledWith(mockUint8Array);
		expect(result).toBe(mockValue);
	});
});

describe('set', () => {
	test('Saves numeric values as-is', async () => {
		const mockValue = 15;

		await kv.set(mockKey, mockValue);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].set).toHaveBeenCalledWith(mockNamespacedKey, mockValue);
	});

	test('Sets the serialized value as buffer on the namespaced key', async () => {
		await kv.set(mockKey, mockValue);

		expect(serialize).toHaveBeenCalledWith(mockValue);
		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(uint8ArrayToBuffer).toHaveBeenCalledWith(mockUint8Array);
		expect(kv['redis'].set).toHaveBeenCalledWith(mockNamespacedKey, mockBuffer);
	});

	test('Compresses the value before saving when compression is enabled and value is large enough', async () => {
		kv = new KvDriverRedis({
			namespace: mockNamespace,
			redis: mockRedis,
			compression: true,
			compressionMinSize: 0,
		});

		await kv.set(mockKey, mockValue);

		expect(serialize).toHaveBeenCalledWith(mockValue);
		expect(compress).toHaveBeenCalledWith(mockUint8Array);
		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(uint8ArrayToBuffer).toHaveBeenCalledWith(mockCompressedUint8Array);
		expect(kv['redis'].set).toHaveBeenCalledWith(mockNamespacedKey, mockBuffer);
	});

	test('Skips compression for values that are too small', async () => {
		kv = new KvDriverRedis({
			namespace: mockNamespace,
			redis: mockRedis,
			compression: true,
			compressionMinSize: 5,
		});

		await kv.set(mockKey, mockValue);

		expect(serialize).toHaveBeenCalledWith(mockValue);
		expect(compress).not.toHaveBeenCalledWith(mockUint8Array);
		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(uint8ArrayToBuffer).toHaveBeenCalledWith(mockUint8Array);
		expect(kv['redis'].set).toHaveBeenCalledWith(mockNamespacedKey, mockBuffer);
	});

	test('Custom TTL', async () => {
		const mockValue = 15;
		const mockTTL = 3600000;

		kv = new KvDriverRedis({
			namespace: mockNamespace,
			redis: mockRedis,
			compression: false,
			ttl: mockTTL,
		});

		await kv.set(mockKey, mockValue);
		expect(kv['redis'].set).toHaveBeenCalledWith(mockNamespacedKey, mockValue, 'PX', mockTTL);
	});

	test('Custom TTL with compression', async () => {
		kv = new KvDriverRedis({
			namespace: mockNamespace,
			redis: mockRedis,
			compression: true,
			compressionMinSize: 0,
			ttl: 3600000,
		});

		await kv.set(mockKey, mockValue);

		expect(kv['redis'].set).toHaveBeenCalledWith(mockNamespacedKey, mockBuffer, 'PX', 3600000);
	});
});

describe('delete', () => {
	test('Calls Redis unlink for given key', async () => {
		await kv.delete(mockKey);
		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].unlink).toHaveBeenCalledWith(mockNamespacedKey);
	});
});

describe('has', () => {
	test('Returns true for exists status 1', async () => {
		vi.mocked(kv['redis'].exists).mockResolvedValueOnce(1);

		const res = await kv.has(mockKey);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].exists).toHaveBeenCalledWith(mockNamespacedKey);
		expect(res).toBe(true);
	});

	test('Returns true for exists status 1', async () => {
		vi.mocked(kv['redis'].exists).mockResolvedValueOnce(0);

		const res = await kv.has(mockKey);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].exists).toHaveBeenCalledWith(mockNamespacedKey);
		expect(res).toBe(false);
	});
});

describe('increment', () => {
	test('Calls Redis incrby with given amount', async () => {
		const mockAmount = 15;

		await kv.increment(mockKey, mockAmount);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].incrby).toHaveBeenCalledWith(mockNamespacedKey, mockAmount);
	});

	test('Returns incremented value from Redis', async () => {
		const mockAmount = 15;
		const mockResult = 42;

		vi.mocked(kv['redis'].incrby).mockResolvedValue(mockResult);

		const res = await kv.increment(mockKey, mockAmount);

		expect(res).toBe(mockResult);
	});

	test('Sets the expiry in the same transaction when a ttl is configured', async () => {
		// A key created by `INCRBY` alone would live for good; the transaction pairs it with `PEXPIRE`
		const withTtl = new KvDriverRedis({ namespace: mockNamespace, redis: mockRedis, ttl: 5000 });

		const exec = vi.fn().mockResolvedValue([
			[null, 42],
			[null, 1],
		]);

		const pexpire = vi.fn(() => ({ exec }));
		const incrby = vi.fn(() => ({ pexpire }));
		vi.mocked(mockRedis.multi).mockReturnValue({ incrby } as any);

		const res = await withTtl.increment(mockKey, 2);

		expect(incrby).toHaveBeenCalledWith(mockNamespacedKey, 2);
		expect(pexpire).toHaveBeenCalledWith(mockNamespacedKey, 5000);
		expect(res).toBe(42);
		expect(mockRedis.incrby).not.toHaveBeenCalled();
	});

	test('Throws the error of the INCRBY reply inside the transaction', async () => {
		// A transaction resolves with the failure inside the reply; it must surface like a plain `incrby` rejection
		const withTtl = new KvDriverRedis({ namespace: mockNamespace, redis: mockRedis, ttl: 5000 });

		const exec = vi.fn().mockResolvedValue([
			[new Error('ERR value is not an integer or out of range'), null],
			[null, 1],
		]);

		vi.mocked(mockRedis.multi).mockReturnValue({ incrby: () => ({ pexpire: () => ({ exec }) }) } as any);

		await expect(withTtl.increment(mockKey)).rejects.toThrow('ERR value is not an integer or out of range');
	});
});

describe('setMax', () => {
	test('Calls custom setMax on Redis instance', async () => {
		// ioredis makes custom functions available as methods, but those aren't typeable
		(kv['redis'] as any).setMax = vi.fn();

		const mockAmount = 15;

		await kv.setMax(mockKey, mockAmount);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect((kv['redis'] as any).setMax).toHaveBeenCalledWith(mockNamespacedKey, mockAmount);
	});

	test('Returns true if setMax returns 1', async () => {
		// ioredis makes custom functions available as methods, but those aren't typeable
		(kv['redis'] as any).setMax = vi.fn().mockResolvedValue(1);

		const mockAmount = 15;

		const res = await kv.setMax(mockKey, mockAmount);

		expect(res).toBe(true);
	});

	test('Returns false if setMax returns 0', async () => {
		// ioredis makes custom functions available as methods, but those aren't typeable
		(kv['redis'] as any).setMax = vi.fn().mockResolvedValue(0);

		const mockAmount = 15;

		const res = await kv.setMax(mockKey, mockAmount);

		expect(res).toBe(false);
	});

	test('Hands the ttl to the script when one is configured', async () => {
		const withTtl = new KvDriverRedis({ namespace: mockNamespace, redis: mockRedis, ttl: 5000 });
		(withTtl['redis'] as any).setMax = vi.fn().mockResolvedValue(1);

		await withTtl.setMax(mockKey, 15);

		expect((withTtl['redis'] as any).setMax).toHaveBeenCalledWith(mockNamespacedKey, 15, 5000);
	});

	test('Returns false if setMax returns null', async () => {
		// Redis answers a Lua `false` with nil, which ioredis reads as `null`: not stored either way
		(kv['redis'] as any).setMax = vi.fn().mockResolvedValue(null);

		const res = await kv.setMax(mockKey, 15);

		expect(res).toBe(false);
	});
});

describe('clear', () => {
	test('Uses stream for iterating over keys, unlinks them in a pipeline, skips empty batches', async () => {
		// A `SCAN` step may match nothing and still answer with an empty batch; `UNLINK` without keys is an error
		kv['redis'].scanStream = vi.fn().mockReturnValue({
			async *[Symbol.asyncIterator]() {
				yield [mockKey];
				yield [];
				yield [mockKey];
			},
		});

		const unlinkFn = vi.fn();
		const execFn = vi.fn();

		kv['redis'].pipeline = vi.fn().mockReturnValue({
			unlink: unlinkFn,
			exec: execFn,
		});

		await kv.clear();

		expect(kv['redis'].pipeline).toHaveBeenCalledOnce();
		expect(withNamespace).toHaveBeenCalledWith('*', mockNamespace);
		expect(unlinkFn).toHaveBeenCalledTimes(2); // See the mocked key chunks from `scanStream`
		expect(execFn).toHaveBeenCalledOnce();
	});
});

describe('acquireLock', () => {
	test('Delegates to redlock acquire and awaits', async () => {
		let innerReleased = false;
		let innerExtended = false;

		const mockLock = {
			release: vi.fn().mockImplementation(async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				innerReleased = true;
			}),
			extend: vi.fn().mockImplementation(async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				innerExtended = true;
			}),
		};

		kv['redlock'].acquire = vi.fn().mockResolvedValue(mockLock);

		const lock = await kv.acquireLock(mockKey);
		expect(kv['redlock'].acquire).toHaveBeenCalledWith([mockNamespacedKey], 5000);

		await lock.release();
		expect(innerReleased).toBe(true);

		await lock.extend(100);
		expect(innerExtended).toBe(true);
	});

	test('Extends and releases through the lock redlock answered with, not the one it invalidated', async () => {
		// Redlock's `extend()` returns a new lock and marks the old one expired; a second extend must go to the new one
		const third = { release: vi.fn(async () => {}), extend: vi.fn(async () => third) };
		const second = { release: vi.fn(async () => {}), extend: vi.fn(async () => third) };
		const first = { release: vi.fn(async () => {}), extend: vi.fn(async () => second) };

		kv['redlock'].acquire = vi.fn().mockResolvedValue(first);

		const lock = await kv.acquireLock(mockKey);

		await lock.extend(100.7);
		await lock.extend(200);
		await lock.release();

		expect(first.extend).toHaveBeenCalledExactlyOnceWith(100);
		expect(second.extend).toHaveBeenCalledExactlyOnceWith(200);
		expect(third.release).toHaveBeenCalledOnce();
		expect(first.release).not.toHaveBeenCalled();
	});
});

describe('usingLock', () => {
	test('Delegates to redlock using', async () => {
		const callback = vi.fn();
		kv['redlock'].using = vi.fn();

		await kv.usingLock(mockKey, callback);
		expect(kv['redlock'].using).toHaveBeenCalledWith([mockNamespacedKey], 5000, callback);
	});
});
