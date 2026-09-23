/**
 * Tests of `memory/kv/lib/drivers/redis`.
 */
import { ExecutionError } from '@sesamecare-oss/redlock';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
import { type ExtendedRedis, INCREMENT_SCRIPT, KvDriverRedis, SET_MAX_SCRIPT } from './redis.js';

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
	// 1. One namespaced key and one byte payload stand in for every value; the utils are automocked, so what they
	//    answer is pinned here and the tests assert on the calls the driver makes
	mockKey = 'test-key';
	mockNamespace = 'test';
	mockNamespacedKey = 'namespaced:test-key';

	mockUint8Array = new Uint8Array();
	mockBuffer = Buffer.from(mockUint8Array);
	mockCompressedUint8Array = new Uint8Array([1, 2, 3]);
	mockDecompressedUint8Array = new Uint8Array([1, 2, 3]);

	mockValue = 'test';

	// 2. Compression off by default, so the byte path is the plain one; the tests that need it build their own store
	mockRedis = new Redis();

	kv = new KvDriverRedis({
		namespace: mockNamespace,
		redis: mockRedis,
		compression: false,
	});

	vi.mocked(withNamespace).mockReturnValue(mockNamespacedKey);
	vi.mocked(escapeGlob).mockImplementation((text) => text);
	vi.mocked(bufferToUint8Array).mockReturnValue(mockUint8Array);
	vi.mocked(uint8ArrayToBuffer).mockReturnValue(mockBuffer as any);
	vi.mocked(compress).mockResolvedValue(mockCompressedUint8Array);
	vi.mocked(decompress).mockResolvedValue(mockDecompressedUint8Array);
	vi.mocked(serialize).mockReturnValue(mockUint8Array);
	vi.mocked(deserialize).mockReturnValue(mockValue);
});

afterEach(() => {
	// 1. Calls are cleared, not the implementations: `beforeEach` sets the answers again for the next test
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Sets internal flags based on config', () => {
		// 1. The config lands on the fields the methods read, unchanged
		expect(kv['redis']).toBe(mockRedis);
		expect(kv['namespace']).toBe(mockNamespace);
		expect(kv['compression']).toBe(false);
	});

	test('Defaults compression settings', () => {
		// 1. Without a word about compression the store gzips, but only from 1 kB up
		const kv = new KvDriverRedis({
			namespace: mockNamespace,
			redis: mockRedis,
		});

		expect(kv['compression']).toBe(true);
		expect(kv['compressionMinSize']).toBe(1000);
	});

	test('Defines the setMax and increment commands if they do not exist yet', () => {
		// 1. Both scripts go on the client; locks go through Redlock, which ships its own release script, so no
		//    command of the driver's own is defined for them
		expect(kv['redis'].defineCommand).toHaveBeenCalledWith('setMax', {
			numberOfKeys: 1,
			lua: SET_MAX_SCRIPT,
		});

		expect(kv['redis'].defineCommand).toHaveBeenCalledWith('increment', {
			numberOfKeys: 1,
			lua: INCREMENT_SCRIPT,
		});

		expect(kv['redis'].defineCommand).toHaveBeenCalledTimes(2);
	});

	test('Skips defining a command that already exists on redis', () => {
		// 1. A client shared with another store already carries the commands; defining them twice is pointless
		const mockRedis = { defineCommand: vi.fn(), setMax: vi.fn(), increment: vi.fn() } as unknown as ExtendedRedis;

		new KvDriverRedis({ redis: mockRedis, namespace: mockNamespace, compression: false });

		expect(mockRedis.defineCommand).not.toHaveBeenCalled();
	});
});

describe('get', () => {
	test('Gets namespaced buffer', async () => {
		// 1. The raw-bytes read goes to the namespaced key; the string API would mangle a compressed payload
		await kv.get(mockKey);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].getBuffer).toHaveBeenCalledWith(mockNamespacedKey);
	});

	test('Returns undefined for null values from Redis', async () => {
		// 1. A nil reply is the missing-key answer of Redis; the driver's is `undefined`, like the local store's
		vi.mocked(kv['redis'].getBuffer).mockResolvedValue(null);

		const result = await kv.get(mockKey);

		expect(result).toBe(undefined);
	});

	test('Returns deserialized buffer', async () => {
		// 1. The reply is viewed as bytes and parsed; nothing else happens to it with compression off
		vi.mocked(kv['redis'].getBuffer).mockResolvedValue(mockBuffer);

		const result = await kv.get(mockKey);

		expect(bufferToUint8Array).toHaveBeenCalledWith(mockBuffer);
		expect(deserialize).toHaveBeenCalledWith(mockUint8Array);
		expect(result).toBe(mockValue);
	});

	test('Decompresses value when compress has been set and value is gzip compressed', async () => {
		// 1. Compression is decided per value on write, so the gzip header of the reply is what triggers gunzip
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
		// 1. A small value was written uncompressed; gunzipping it would fail, so the header check must say no
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

	test('Decompresses a compressed value even when compression is disabled here', async () => {
		// 1. Compression is decided per value on write, so the header alone decides: a value gzipped by another process
		//    under the same namespace must read back fine for a store with compression off. The default store has it off
		vi.mocked(kv['redis'].getBuffer).mockResolvedValue(mockBuffer);

		vi.mocked(isCompressed).mockReturnValue(true);

		const result = await kv.get(mockKey);

		expect(bufferToUint8Array).toHaveBeenCalledWith(mockBuffer);
		expect(decompress).toHaveBeenCalledWith(mockUint8Array);
		expect(deserialize).toHaveBeenCalledWith(mockDecompressedUint8Array);
		expect(result).toBe(mockValue);
	});
});

describe('set', () => {
	test('Saves finite numeric values as-is', async () => {
		// 1. A number is written raw, so `INCRBY` and the `setMax` script can read it
		const mockValue = 15;

		await kv.set(mockKey, mockValue);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].set).toHaveBeenCalledWith(mockNamespacedKey, mockValue);
		expect(serialize).not.toHaveBeenCalled();
	});

	test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		'Serializes %s instead of writing it raw',
		async (value) => {
			// 1. Written raw, the text `NaN` or `Infinity` is not JSON and every later `get` would throw; the JSON path
			//    stores `null`, as the local store does
			await kv.set(mockKey, value);

			expect(serialize).toHaveBeenCalledWith(value);
			expect(kv['redis'].set).toHaveBeenCalledWith(mockNamespacedKey, mockBuffer);
		},
	);

	test('Sets the serialized value as buffer on the namespaced key', async () => {
		// 1. Everything but a number goes through JSON and is handed to ioredis as a buffer
		await kv.set(mockKey, mockValue);

		expect(serialize).toHaveBeenCalledWith(mockValue);
		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(uint8ArrayToBuffer).toHaveBeenCalledWith(mockUint8Array);
		expect(kv['redis'].set).toHaveBeenCalledWith(mockNamespacedKey, mockBuffer);
	});

	test('Compresses the value before saving when compression is enabled and value is large enough', async () => {
		// 1. A threshold of zero makes every value large enough, so the gzip step is the one under test
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
		// 1. The empty payload sits under the 5-byte threshold, so gzip would cost more than it saves
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
		// 1. The expiry travels with the write as `PX`, one round trip for both
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
		// 1. The byte path sets the same `PX` expiry as the number path
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
		// 1. `UNLINK` rather than `DEL`, so a large value is freed off the main thread
		await kv.delete(mockKey);
		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].unlink).toHaveBeenCalledWith(mockNamespacedKey);
	});
});

describe('has', () => {
	test('Returns true for exists status 1', async () => {
		// 1. `EXISTS` counts matching keys; one key asked, so `1` means present
		vi.mocked(kv['redis'].exists).mockResolvedValueOnce(1);

		const res = await kv.has(mockKey);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].exists).toHaveBeenCalledWith(mockNamespacedKey);
		expect(res).toBe(true);
	});

	test('Returns false for exists status 0', async () => {
		// 1. A count of zero is the only "missing" answer
		vi.mocked(kv['redis'].exists).mockResolvedValueOnce(0);

		const res = await kv.has(mockKey);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(kv['redis'].exists).toHaveBeenCalledWith(mockNamespacedKey);
		expect(res).toBe(false);
	});
});

describe('increment', () => {
	test('Runs the increment script with the given amount and answers with its reply', async () => {
		// 1. ioredis attaches a defined command as a method, which the automock does not know; it is added by hand
		const increment = vi.fn().mockResolvedValue(42);
		(kv['redis'] as any).increment = increment;

		const res = await kv.increment(mockKey, 15);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect(increment).toHaveBeenCalledExactlyOnceWith(mockNamespacedKey, 15);
		expect(res).toBe(42);
	});

	test('Defaults the amount to 1', async () => {
		// 1. A bare `increment` is the common counter bump
		const increment = vi.fn().mockResolvedValue(1);
		(kv['redis'] as any).increment = increment;

		await kv.increment(mockKey);

		expect(increment).toHaveBeenCalledExactlyOnceWith(mockNamespacedKey, 1);
	});

	test('Hands the ttl to the script when one is configured', async () => {
		// 1. The script sets the expiry after `INCRBY`; a key created by `INCRBY` alone would live for good
		const withTtl = new KvDriverRedis({ namespace: mockNamespace, redis: mockRedis, ttl: 5000 });
		const increment = vi.fn().mockResolvedValue(42);
		(withTtl['redis'] as any).increment = increment;

		const res = await withTtl.increment(mockKey, 2);

		expect(increment).toHaveBeenCalledExactlyOnceWith(mockNamespacedKey, 2, 5000);
		expect(res).toBe(42);
	});

	test.each([0.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'Refuses the amount %s before the round trip',
		async (amount) => {
			// 1. `INCRBY` takes integers only; the refusal is the local store's, so both backends fail alike and no
			//    request goes out
			const increment = vi.fn();
			(kv['redis'] as any).increment = increment;

			await expect(kv.increment(mockKey, amount)).rejects.toThrow(RangeError);

			await expect(kv.increment(mockKey, amount)).rejects.toThrow(
				`The amount for key "${mockKey}" must be an integer, got ${amount}`,
			);

			expect(increment).not.toHaveBeenCalled();
		},
	);

	test.each([
		// 1. The reply of a plain `INCRBY` on a value that is no integer
		'ERR value is not an integer or out of range',
		// 2. The same reply as a script failure, which Redis wraps — the match is on the exact sentence, not the
		//    start of the message
		'ERR Error running script (call to f_6b1bf486c81ce7c696ab12ec092a6f1f8c1a1c9f): @user_script:1: ERR value is not an integer or out of range',
	])('Throws the error of the local store for the INCRBY reply %j, with the reply as cause', async (message) => {
		// 1. The reply error of Redis is the backend's own wording; the caller gets the shared message and can still
		//    reach the reply through `cause`
		const reply = new Error(message);
		(kv['redis'] as any).increment = vi.fn().mockRejectedValue(reply);

		const error = await kv.increment(mockKey).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({ message: `The value for key "${mockKey}" is not an integer.`, cause: reply });
	});

	test('Passes an error that merely says "not an integer" through unchanged', async () => {
		// 1. Only the exact INCRBY reply is translated; an error that happens to carry the words must reach the
		//    caller as it is, not be renamed into a value error
		const reply = new Error('ERR value is not an integer');
		(kv['redis'] as any).increment = vi.fn().mockRejectedValue(reply);

		await expect(kv.increment(mockKey)).rejects.toBe(reply);
	});

	test('Passes any other failure through unchanged', async () => {
		// 1. A connection error is not a bad value and must not be reported as one
		const reply = new Error('Connection is closed.');
		(kv['redis'] as any).increment = vi.fn().mockRejectedValue(reply);

		await expect(kv.increment(mockKey)).rejects.toBe(reply);
	});
});

describe('setMax', () => {
	test('Calls custom setMax on Redis instance', async () => {
		// 1. ioredis makes custom functions available as methods, but those aren't typeable; the value goes as text
		(kv['redis'] as any).setMax = vi.fn();

		const mockAmount = 15;

		await kv.setMax(mockKey, mockAmount);

		expect(withNamespace).toHaveBeenCalledWith(mockKey, mockNamespace);
		expect((kv['redis'] as any).setMax).toHaveBeenCalledWith(mockNamespacedKey, '15');
	});

	test('Passes a float as text, so the script stores it verbatim', async () => {
		// 1. As a Lua number the value would go back to text with 17 significant digits (`0.10000000000000001`);
		//    handed over as text, the script stores exactly what `set` stores
		const setMax = vi.fn().mockResolvedValue(1);
		(kv['redis'] as any).setMax = setMax;

		const wasSet = await kv.setMax(mockKey, 0.1);

		expect(setMax).toHaveBeenCalledExactlyOnceWith(mockNamespacedKey, '0.1');
		expect(wasSet).toBe(true);
	});

	test('Returns true if setMax returns 1', async () => {
		// 1. `1` is the script's "stored"
		(kv['redis'] as any).setMax = vi.fn().mockResolvedValue(1);

		const mockAmount = 15;

		const res = await kv.setMax(mockKey, mockAmount);

		expect(res).toBe(true);
	});

	test('Returns false if setMax returns 0', async () => {
		// 1. `0` is the script's "not larger"
		(kv['redis'] as any).setMax = vi.fn().mockResolvedValue(0);

		const mockAmount = 15;

		const res = await kv.setMax(mockKey, mockAmount);

		expect(res).toBe(false);
	});

	test('Hands the ttl to the script when one is configured', async () => {
		// 1. The expiry travels into the script, so a key `setMax` creates expires like one `set` wrote
		const withTtl = new KvDriverRedis({ namespace: mockNamespace, redis: mockRedis, ttl: 5000 });
		(withTtl['redis'] as any).setMax = vi.fn().mockResolvedValue(1);

		await withTtl.setMax(mockKey, 15);

		expect((withTtl['redis'] as any).setMax).toHaveBeenCalledWith(mockNamespacedKey, '15', 5000);
	});

	test('Returns false if setMax returns null', async () => {
		// 1. Redis answers a Lua `false` with nil, which ioredis reads as `null`: not stored either way
		(kv['redis'] as any).setMax = vi.fn().mockResolvedValue(null);

		const res = await kv.setMax(mockKey, 15);

		expect(res).toBe(false);
	});

	test('Throws the error of the local store when the script reports a non-number under the key', async () => {
		// 1. `-1` is the script's "no number to compare with"; a `false` would read as "not larger" and hide the
		//    bad value, so it is the same error the local store throws
		(kv['redis'] as any).setMax = vi.fn().mockResolvedValue(-1);

		await expect(kv.setMax(mockKey, 15)).rejects.toThrow(`The value for key "${mockKey}" is not a number.`);
	});

	test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		'Refuses %s before the round trip',
		async (value) => {
			// 1. Lua's `tonumber` cannot read the text these become, and the script would die comparing nil; the
			//    refusal is the local store's, so both backends fail alike
			const setMax = vi.fn();
			(kv['redis'] as any).setMax = setMax;

			await expect(kv.setMax(mockKey, value)).rejects.toThrow(RangeError);
			expect(setMax).not.toHaveBeenCalled();
		},
	);
});

describe('clear', () => {
	test('Uses stream for iterating over keys, unlinks them in a pipeline, skips empty batches', async () => {
		// 1. A `SCAN` step may match nothing and still answer with an empty batch; `UNLINK` without keys is an error
		kv['redis'].scanStream = vi.fn().mockReturnValue({
			async *[Symbol.asyncIterator]() {
				yield [mockKey];
				yield [];
				yield [mockKey];
			},
		});

		const unlinkFn = vi.fn();
		const execFn = vi.fn().mockResolvedValue([]);

		kv['redis'].pipeline = vi.fn().mockReturnValue({
			unlink: unlinkFn,
			exec: execFn,
		});

		await kv.clear();

		// 2. Two of the three mocked `scanStream` batches carry keys; the empty one is skipped, and everything goes
		//    out in one pipeline
		expect(kv['redis'].pipeline).toHaveBeenCalledOnce();
		expect(withNamespace).toHaveBeenCalledWith('*', mockNamespace);
		expect(unlinkFn).toHaveBeenCalledTimes(2);
		expect(execFn).toHaveBeenCalledOnce();
	});

	test('Escapes the namespace in the SCAN pattern', async () => {
		// 1. `MATCH` reads `*`, `?`, `[`, `]` and `\` as operators; a namespace holding one must reach it escaped, or
		//    `clear()` unlinks another store's keys and leaves its own
		const glob = new KvDriverRedis({ namespace: 'tenant[1]', redis: mockRedis, compression: false });
		vi.mocked(escapeGlob).mockReturnValue('tenant\\[1\\]');

		glob['redis'].scanStream = vi.fn().mockReturnValue({
			async *[Symbol.asyncIterator]() {},
		});

		glob['redis'].pipeline = vi.fn().mockReturnValue({ unlink: vi.fn(), exec: vi.fn().mockResolvedValue([]) });

		await glob.clear();

		expect(escapeGlob).toHaveBeenCalledWith('tenant[1]');
		expect(withNamespace).toHaveBeenCalledWith('*', 'tenant\\[1\\]');
		expect(glob['redis'].scanStream).toHaveBeenCalledWith({ match: mockNamespacedKey });
	});

	test('Throws when Redis refused an UNLINK or the pipeline was aborted', async () => {
		// 1. `exec()` resolves with the reply error in its tuple instead of rejecting; `clear()` must surface it
		const refused = new Error("READONLY You can't write against a read only replica.");

		kv['redis'].scanStream = vi.fn().mockReturnValue({
			async *[Symbol.asyncIterator]() {
				yield [mockKey];
			},
		});

		kv['redis'].pipeline = vi.fn().mockReturnValue({
			unlink: vi.fn(),
			exec: vi.fn().mockResolvedValue([[refused, null]]),
		});

		await expect(kv.clear()).rejects.toBe(refused);

		// 2. A `null` answer means the pipeline never ran
		kv['redis'].pipeline = vi.fn().mockReturnValue({ unlink: vi.fn(), exec: vi.fn().mockResolvedValue(null) });

		await expect(kv.clear()).rejects.toThrow(`Clearing namespace "${mockNamespace}" was aborted`);
	});
});

describe('acquireLock', () => {
	test('Delegates to redlock acquire and awaits', async () => {
		// 1. A Redlock lock double that records whether its own release and extend ran
		let innerReleased = false;
		let innerExtended = false;

		const mockLock = {
			release: vi.fn().mockImplementation(async () => {
				// 1. A short wait, so the handle is proven to await the release rather than fire and forget it
				await new Promise((resolve) => setTimeout(resolve, 10));
				innerReleased = true;
			}),
			extend: vi.fn().mockImplementation(async () => {
				// 1. The same for the extension
				await new Promise((resolve) => setTimeout(resolve, 10));
				innerExtended = true;
			}),
		};

		kv['redlock'].acquire = vi.fn().mockResolvedValue(mockLock);

		kv['redlock'].release = vi.fn(async (held: unknown) => {
			// 1. Redlock's `release` releases the lock it is handed and answers with the execution stats
			await (held as { release: () => Promise<void> }).release();
			return { attempts: [], start: 0 };
		}) as never;

		// 2. The lock is asked for under the locks namespace, for the configured timeout
		const lock = await kv.acquireLock(mockKey);
		expect(withNamespace).toHaveBeenCalledWith(mockKey, `${mockNamespace}-locks`);
		expect(kv['redlock'].acquire).toHaveBeenCalledWith([mockNamespacedKey], 5000);

		// 3. The release goes through Redlock without retries: a lock already gone must not be retried for 5 s; and it
		//    goes once, a second release of the handle is a no-op like the local store's
		await lock.release();
		await lock.release();
		expect(kv['redlock'].release).toHaveBeenCalledExactlyOnceWith(mockLock, { retryCount: 0 });
		expect(innerReleased).toBe(true);

		// 4. Extending goes to the Redlock lock as well
		await lock.extend(100);
		expect(innerExtended).toBe(true);
	});

	test('Extends and releases through the lock redlock answered with, not the one it invalidated', async () => {
		// 1. Redlock's `extend()` returns a new lock and marks the old one expired; a second extend must go to the new one
		const third = { release: vi.fn(async () => {}), extend: vi.fn(async () => third) };
		const second = { release: vi.fn(async () => {}), extend: vi.fn(async () => third) };
		const first = { release: vi.fn(async () => {}), extend: vi.fn(async () => second) };

		kv['redlock'].acquire = vi.fn().mockResolvedValue(first);
		kv['redlock'].release = vi.fn(async () => ({ attempts: [], start: 0 })) as never;

		const lock = await kv.acquireLock(mockKey);

		await lock.extend(100.7);
		await lock.extend(200);
		await lock.release();

		// 2. Each extend went to the current lock, floored to the integer Redlock wants; the release to the last one
		expect(first.extend).toHaveBeenCalledExactlyOnceWith(100);
		expect(second.extend).toHaveBeenCalledExactlyOnceWith(200);
		expect(kv['redlock'].release).toHaveBeenCalledWith(third, { retryCount: 0 });
	});

	test('Throws the error of the local store once the retry budget is spent, with the Redlock failure as cause', async () => {
		// 1. Redlock reports a busy lock as a quorum failure naming neither key nor budget; the caller gets the message
		//    the local store uses, key and budget included, and can still reach the votes through `cause`
		const failure = new ExecutionError('The operation was unable to achieve a quorum during its retry window.', []);
		kv['redlock'].acquire = vi.fn().mockRejectedValue(failure);

		const error = await kv.acquireLock(mockKey).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(ExecutionError);
		expect(error).toMatchObject({ message: `Lock "${mockKey}" was not acquired within 5000 ms`, cause: failure });
	});

	test('Passes any other acquire failure through unchanged', async () => {
		// 1. A connection error is not a busy lock and must not be reported as one
		const failure = new Error('Connection is closed.');
		kv['redlock'].acquire = vi.fn().mockRejectedValue(failure);

		await expect(kv.acquireLock(mockKey)).rejects.toBe(failure);
	});
});

describe('usingLock', () => {
	test('Delegates to redlock using and runs the callback through it', async () => {
		// 1. The lock is asked for under the locks namespace, for the configured timeout; the routine handed to
		//    Redlock is the driver's wrapper, which runs the callback once Redlock acquired the lock
		const callback = vi.fn().mockResolvedValue('result');

		kv['redlock'].using = vi.fn(async (_resources: unknown, _duration: unknown, routine: unknown) =>
			(routine as () => Promise<unknown>)(),
		) as never;

		await expect(kv.usingLock(mockKey, callback)).resolves.toBe('result');
		expect(withNamespace).toHaveBeenCalledWith(mockKey, `${mockNamespace}-locks`);
		expect(kv['redlock'].using).toHaveBeenCalledWith([mockNamespacedKey], 5000, expect.any(Function));
		expect(callback).toHaveBeenCalledOnce();
	});

	test('Throws the error of the local store when the lock cannot be acquired', async () => {
		// 1. A quorum failure before the callback ran is the acquire giving up; it gets the shared message
		const failure = new ExecutionError('The operation was unable to achieve a quorum during its retry window.', []);
		kv['redlock'].using = vi.fn().mockRejectedValue(failure);

		const callback = vi.fn();
		const error = await kv.usingLock(mockKey, callback).catch((caught: unknown) => caught);

		expect(callback).not.toHaveBeenCalled();
		expect(error).toMatchObject({ message: `Lock "${mockKey}" was not acquired within 5000 ms`, cause: failure });
	});

	test('Passes a failure after the callback ran through unchanged, like the error of the callback itself', async () => {
		// 1. A quorum failure once the callback ran comes from the release, not from the acquire: the lock was held,
		//    so it must not be reported as never acquired
		const failure = new ExecutionError('The operation was unable to achieve a quorum during its retry window.', []);

		kv['redlock'].using = vi.fn(async (_resources: unknown, _duration: unknown, routine: unknown) => {
			// 1. The routine runs to the end; the failure is the release's, raised afterwards
			await (routine as () => Promise<unknown>)();
			throw failure;
		}) as never;

		await expect(kv.usingLock(mockKey, vi.fn().mockResolvedValue('done'))).rejects.toBe(failure);

		// 2. The callback's own error passes through as well
		kv['redlock'].using = vi.fn(async (_resources: unknown, _duration: unknown, routine: unknown) =>
			(routine as () => Promise<unknown>)(),
		) as never;

		await expect(kv.usingLock(mockKey, vi.fn().mockRejectedValue(new Error('boom')))).rejects.toThrow('boom');
	});

	test("Keeps the callback error when the release in Redlock's finally fails as well", async () => {
		// 1. Redlock releases in a `finally`; a release that throws there would replace the callback's error in flight
		const release = new ExecutionError('The operation was unable to achieve a quorum during its retry window.', []);
		const boom = new Error('boom');

		kv['redlock'].using = vi.fn(async (_resources: unknown, _duration: unknown, routine: unknown) => {
			// 1. Mirror Redlock: run the routine, then release in `finally`, which throws
			try {
				return await (routine as () => Promise<unknown>)();
			} finally {
				// eslint-disable-next-line no-unsafe-finally
				throw release;
			}
		}) as never;

		await expect(kv.usingLock(mockKey, vi.fn().mockRejectedValue(boom))).rejects.toBe(boom);
	});
});

describe('redlock settings', () => {
	test('Follows the client into its database and keeps the extension threshold below the lock timeout', () => {
		// 1. Redlock runs `SELECT` on the database it is told, 0 unless told; and `using` refuses a duration less than
		//    100 ms above the auto-extension threshold, so a short lock timeout lowers the threshold
		const inDb2 = new Redis();
		(inDb2 as { options: { db?: number } }).options = { db: 2 };

		const short = new KvDriverRedis({ namespace: mockNamespace, redis: inDb2, lockTimeout: 300 });

		expect(short['redlock'].settings).toMatchObject({ db: 2, automaticExtensionThreshold: 200, retryCount: 6 });
		expect(kv['redlock'].settings).toMatchObject({ db: 0, automaticExtensionThreshold: 500, retryCount: 100 });
	});

	test('Refuses a lock timeout under 200 ms or past a timer, and a client on a database Redlock cannot lock in', () => {
		// 1. Under 200 ms Redlock has no headroom to renew; past a timer the retries would never end
		expect(() => new KvDriverRedis({ namespace: mockNamespace, redis: mockRedis, lockTimeout: 199 })).toThrow(
			RangeError,
		);

		expect(() => new KvDriverRedis({ namespace: mockNamespace, redis: mockRedis, lockTimeout: Infinity })).toThrow(
			RangeError,
		);

		expect(() => new KvDriverRedis({ namespace: mockNamespace, redis: mockRedis, lockTimeout: 200 })).not.toThrow();

		// 2. Redlock silently falls back to database 0 above 15, which would put the locks elsewhere than the values
		const inDb16 = new Redis();
		(inDb16 as { options: { db?: number } }).options = { db: 16 };

		expect(() => new KvDriverRedis({ namespace: mockNamespace, redis: inDb16 })).toThrow(
			'Redlock can only lock in databases 0 to 15',
		);
	});
});
