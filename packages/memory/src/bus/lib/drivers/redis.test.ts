/**
 * Tests of `memory/bus/lib/drivers/redis`.
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
	uint8ArrayToString,
	withNamespace,
} from '../../../utils/index.js';
import type { MessageHandler } from '../../types.js';
import { reportUnreadable } from '../../utils/dispatch.js';
import { BusDriverRedis } from './redis.js';

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('ioredis');
vi.mock('../../../utils/index.js');
vi.mock('../../utils/dispatch.js', { spy: true });
vi.mock('@novastarter/logger', () => ({ useLogger: () => ({ warn: mockWarn }) }));

let mockRedis: Redis;
let mockSubRedis: Redis;
let mockNamespace: string;
let mockChannel: string;
let mockNamespacedChannel: string;
let mockNamespacedChannelBuffer: Buffer;
let mockUint8Array: Uint8Array;
let mockBuffer: Buffer<ArrayBuffer>;
let mockCompressedUint8Array: Uint8Array;
let mockDecompressedUint8Array: Uint8Array;
let mockMessage: string;
let mockHandler: MessageHandler;
let bus: BusDriverRedis;

beforeEach(() => {
	// 1. Two automocked clients: the driver duplicates the one it is given for subscribing, so the duplicate has to be
	//    a client of its own for the assertions to tell the two connections apart
	mockRedis = new Redis();
	mockSubRedis = new Redis();

	vi.mocked(mockRedis.duplicate).mockReturnValue(mockSubRedis);

	// 2. ioredis answers `SUBSCRIBE` with a promise of the subscription count; the automock has to as well, since the
	//    driver chains on it
	vi.mocked(mockSubRedis.subscribe).mockResolvedValue(1);

	// 3. Fixed names and bytes, so every assertion below can name what the driver must have passed on
	mockNamespace = 'test-namespace';
	mockChannel = 'test-channel';
	mockNamespacedChannel = 'test-namespace:test-channel';
	mockNamespacedChannelBuffer = Buffer.from(mockNamespacedChannel);
	mockMessage = 'test-message';
	mockHandler = vi.fn();

	mockUint8Array = new Uint8Array([1, 2, 3]);
	mockBuffer = Buffer.from(mockUint8Array);
	mockCompressedUint8Array = new Uint8Array([1]);
	mockDecompressedUint8Array = new Uint8Array([1, 2, 3]);

	bus = new BusDriverRedis({
		redis: mockRedis,
		namespace: 'test-namespace',
	});

	// 4. The utilities are automocked, so each one answers with the fixed bytes; the tests then assert on which
	//    utility received what, not on the encoding itself
	vi.mocked(withNamespace).mockReturnValue(mockNamespacedChannel);
	vi.mocked(uint8ArrayToString).mockReturnValue(mockNamespacedChannel);
	vi.mocked(bufferToUint8Array).mockReturnValue(mockUint8Array);
	vi.mocked(uint8ArrayToBuffer).mockReturnValue(mockBuffer);
	vi.mocked(compress).mockResolvedValue(mockCompressedUint8Array);
	vi.mocked(decompress).mockResolvedValue(mockDecompressedUint8Array);
	vi.mocked(serialize).mockReturnValue(mockUint8Array);
	vi.mocked(deserialize).mockReturnValue(mockMessage);
	vi.mocked(isCompressed).mockReturnValue(true);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Sets internal flags based on config', () => {
		// 1. The given client publishes, its duplicate subscribes
		expect(bus['pub']).toBe(mockRedis);
		expect(bus['sub']).toBe(mockSubRedis);
		expect(bus['namespace']).toBe(mockNamespace);
		expect(bus['handlers']).toEqual(new Map());
	});

	test('Defaults compression settings', () => {
		// 1. The documented defaults: compress, from 1 kB up
		expect(bus['compression']).toBe(true);
		expect(bus['compressionMinSize']).toBe(1000);
	});

	test('Allows setting compression settings', () => {
		// 1. Explicit options win over the defaults
		const bus = new BusDriverRedis({
			redis: mockRedis,
			namespace: mockNamespace,
			compression: false,
			compressionMinSize: 50,
		});

		expect(bus['compression']).toBe(false);
		expect(bus['compressionMinSize']).toBe(50);
	});

	test('Subscribes to messageBuffers in sub redis', () => {
		// 1. The binary event, not `message`: a gzipped payload must not go through a string
		expect(bus['sub'].on).toHaveBeenCalledWith('messageBuffer', expect.any(Function));
	});
});

describe('publish', () => {
	test('Publishes binary array for given payload', async () => {
		// 1. The serialised bytes reach the publishing client as a buffer under the namespaced name
		await bus.publish(mockChannel, mockMessage);

		expect(uint8ArrayToBuffer).toHaveBeenCalledWith(mockUint8Array);
		expect(bus['pub'].publish).toHaveBeenCalledWith(mockNamespacedChannel, mockBuffer);
	});

	test('Skips compression if compression is set to false', async () => {
		// 1. With compression off the serialised bytes go out as they are, whatever their size
		bus = new BusDriverRedis({
			redis: mockRedis,
			namespace: 'test-namespace',
			compression: false,
		});

		await bus.publish(mockChannel, mockMessage);

		expect(uint8ArrayToBuffer).toHaveBeenCalledWith(mockUint8Array);
		expect(bus['pub'].publish).toHaveBeenCalledWith(mockNamespacedChannel, mockBuffer);
	});

	test('Compresses if compression is enabled, and value is larger than min size', async () => {
		// 1. A threshold below the payload size, so the compressed bytes are what gets published
		bus = new BusDriverRedis({
			redis: mockRedis,
			namespace: 'test-namespace',
			compression: true,
			compressionMinSize: 1,
		});

		await bus.publish(mockChannel, mockMessage);

		expect(compress).toHaveBeenCalledWith(mockUint8Array);
		expect(uint8ArrayToBuffer).toHaveBeenCalledWith(mockCompressedUint8Array);
		expect(bus['pub'].publish).toHaveBeenCalledWith(mockNamespacedChannel, mockBuffer);
	});

	test('Hands messages to Redis in the order they were published, even when one needs compressing', async () => {
		// 1. A large payload compresses asynchronously; a small one published right behind it, without awaiting the
		//    first, must not overtake it on the connection
		bus = new BusDriverRedis({
			redis: mockRedis,
			namespace: 'test-namespace',
			compressionMinSize: 2,
		});

		vi.mocked(serialize)
			.mockReturnValueOnce(new Uint8Array([1, 2, 3]))
			.mockReturnValueOnce(new Uint8Array([9]));

		vi.mocked(compress).mockImplementationOnce(
			() => new Promise((resolve) => setTimeout(() => resolve(new Uint8Array([7, 7])), 5)),
		);

		vi.mocked(uint8ArrayToBuffer).mockImplementation((input) => Buffer.from(input));

		// 2. Neither publish is awaited before the next one starts, the way a fire-and-forget log stream publishes
		const big = bus.publish(mockChannel, 'big');
		const small = bus.publish(mockChannel, 'small');

		await Promise.all([big, small]);

		expect(vi.mocked(bus['pub'].publish).mock.calls.map(([, message]) => [...(message as Buffer)])).toStrictEqual([
			[7, 7],
			[9],
		]);
	});

	test('Rejects a payload that cannot be serialised and still publishes the next one', async () => {
		// 1. A `BigInt` or a cycle fails in `serialize`; the failure is the caller's, the chain must not be stuck on it
		vi.mocked(serialize).mockImplementationOnce(() => {
			throw new TypeError('Do not know how to serialize a BigInt');
		});

		await expect(bus.publish(mockChannel, { n: 1n })).rejects.toThrow(TypeError);

		// 2. The following publish goes through as if nothing happened
		await bus.publish(mockChannel, mockMessage);

		expect(bus['pub'].publish).toHaveBeenCalledTimes(1);
		expect(bus['pub'].publish).toHaveBeenCalledWith(mockNamespacedChannel, mockBuffer);
	});
});

describe('subscribe', () => {
	test('Subscribes the redis sub to given channel if handlers do not exist yet', async () => {
		// 1. The first callback of a channel is what asks Redis
		await bus.subscribe(mockChannel, mockHandler);

		expect(bus['sub'].subscribe).toHaveBeenCalledWith(mockNamespacedChannel);
	});

	test('Does not call redis subscribe if set already exists', async () => {
		// 1. A channel Redis already delivers needs no second `SUBSCRIBE`
		bus['handlers'].set(mockNamespacedChannel, new Set([vi.fn()]));

		await bus.subscribe(mockChannel, mockHandler);

		expect(bus['sub'].subscribe).not.toHaveBeenCalled();
	});

	test('Saves callback to new handlers set for namespaced channel', async () => {
		// 1. The set is keyed by the namespaced name, the one Redis reports messages under
		await bus.subscribe(mockChannel, mockHandler);

		expect(bus['handlers'].get(mockNamespacedChannel)).toBeInstanceOf(Set);
		expect(bus['handlers'].get(mockNamespacedChannel)?.size).toBe(1);
		expect(Array.from(bus['handlers'].get(mockNamespacedChannel)!)[0]).toBe(mockHandler);
	});

	test('Adds callback to existing handler set', async () => {
		// 1. A later callback joins the set the first one created
		bus['handlers'].set(mockNamespacedChannel, new Set([vi.fn()]));

		await bus.subscribe(mockChannel, mockHandler);

		expect(bus['handlers'].get(mockNamespacedChannel)).toBeInstanceOf(Set);
		expect(bus['handlers'].get(mockNamespacedChannel)?.size).toBe(2);
		expect(Array.from(bus['handlers'].get(mockNamespacedChannel)!)[1]).toBe(mockHandler);
	});

	test('Tells a caller that joined during a failing SUBSCRIBE about the failure too', async () => {
		// 1. The set exists before Redis answered; a second caller joins it and must share the outcome, not be told its
		//    handler is in place while the failing first call is about to drop the set
		let reject!: (error: Error) => void;

		vi.mocked(bus['sub'].subscribe).mockReturnValueOnce(
			new Promise((_, rej) => {
				reject = rej;
			}) as never,
		);

		const first = bus.subscribe(mockChannel, mockHandler);
		const second = bus.subscribe(mockChannel, vi.fn());

		reject(new Error('connection lost'));

		// 2. Both callers see the failure and nothing of the attempt is left behind
		await expect(first).rejects.toThrow('connection lost');
		await expect(second).rejects.toThrow('connection lost');
		expect(bus['handlers'].get(mockNamespacedChannel)).toBeUndefined();
		expect(bus['pending'].get(mockNamespacedChannel)).toBeUndefined();
	});

	test('A stale SUBSCRIBE failure does not remove a newer subscription of the same channel', async () => {
		// 1. Subscribe, unsubscribe while Redis has not answered, subscribe again: the first call's failure must leave the
		//    second call's set and pending promise alone, or the second caller is told it succeeded while no handler is left
		let rejectFirst!: (error: Error) => void;

		vi.mocked(bus['sub'].subscribe)
			.mockReturnValueOnce(
				new Promise((_, rej) => {
					rejectFirst = rej;
				}) as never,
			)
			.mockResolvedValueOnce(1);

		const first = bus.subscribe(mockChannel, mockHandler);
		await bus.unsubscribe(mockChannel, mockHandler);

		const later = vi.fn();
		const second = bus.subscribe(mockChannel, later);

		rejectFirst(new Error('connection lost'));

		// 2. Only the first caller fails; the second one's subscription stands
		await expect(first).rejects.toThrow('connection lost');
		await expect(second).resolves.toBeUndefined();
		expect(bus['handlers'].get(mockNamespacedChannel)).toEqual(new Set([later]));
		expect(bus['pending'].get(mockNamespacedChannel)).toBeUndefined();
	});

	test('Leaves no handler set behind when the Redis SUBSCRIBE fails, so a retry subscribes again', async () => {
		// 1. A set left in place would send the retry down the "already subscribed" branch and never ask Redis again
		vi.mocked(bus['sub'].subscribe).mockRejectedValueOnce(new Error('connection lost'));

		await expect(bus.subscribe(mockChannel, mockHandler)).rejects.toThrow('connection lost');
		expect(bus['handlers'].get(mockNamespacedChannel)).toBeUndefined();

		// 2. The retry asks Redis afresh and registers the handler
		vi.mocked(bus['sub'].subscribe).mockResolvedValueOnce(1);
		await bus.subscribe(mockChannel, mockHandler);

		expect(bus['sub'].subscribe).toHaveBeenCalledTimes(2);
		expect(bus['handlers'].get(mockNamespacedChannel)?.size).toBe(1);
	});

	test('Rejects once the bus is closed, without asking Redis', async () => {
		// 1. The subscribing connection is gone; a handler registered now would never fire
		await bus.close();

		await expect(bus.subscribe(mockChannel, mockHandler)).rejects.toThrow('The bus is closed');
		expect(bus['sub'].subscribe).not.toHaveBeenCalled();
		expect(bus['handlers']).toEqual(new Map());
	});

	test('Rejects a subscribe whose SUBSCRIBE was on the wire when close() landed, for every caller waiting on it', async () => {
		// 1. Redis answers the `SUBSCRIBE` only after `close()` ran; ioredis serves the reply before the queued `QUIT`
		let resolve!: (count: number) => void;

		vi.mocked(bus['sub'].subscribe).mockReturnValueOnce(
			new Promise((res) => {
				resolve = res;
			}) as never,
		);

		const first = bus.subscribe(mockChannel, mockHandler);
		const second = bus.subscribe(mockChannel, vi.fn());

		await bus.close();
		resolve(1);

		// 2. Neither caller is told its handler is in place: the set went with the connection
		await expect(first).rejects.toThrow('The bus is closed');
		await expect(second).rejects.toThrow('The bus is closed');
		expect(bus['handlers']).toEqual(new Map());
		expect(bus['pending']).toEqual(new Map());
	});
});

describe('unsubscribe', () => {
	test('Returns early when no handlers exist for channel', async () => {
		// 1. An unknown channel is not an error, and Redis is not bothered about it
		await bus.unsubscribe(mockNamespacedChannel, mockHandler);

		expect(bus['sub'].unsubscribe).not.toHaveBeenCalled();
	});

	test('Deletes given callback from local handler set', async () => {
		// 1. With another subscriber left, Redis keeps delivering the channel
		const mockHandlerB = vi.fn();
		const existingSet = new Set([mockHandler, mockHandlerB]);
		bus['handlers'].set(mockNamespacedChannel, existingSet);

		await bus.unsubscribe(mockChannel, mockHandler);

		expect(bus['handlers'].get(mockNamespacedChannel)).toEqual(new Set([mockHandlerB]));
		expect(bus['sub'].unsubscribe).not.toHaveBeenCalled();
	});

	test('Deletes set and unsubscribes redis when all handlers are removed', async () => {
		// 1. The last subscriber takes the channel with it, so the connection stops receiving its messages
		const existingSet = new Set([mockHandler]);
		bus['handlers'].set(mockNamespacedChannel, existingSet);

		await bus.unsubscribe(mockChannel, mockHandler);

		expect(bus['handlers'].get(mockNamespacedChannel)).toBeUndefined();
		expect(bus['sub'].unsubscribe).toHaveBeenCalledWith(mockNamespacedChannel);
	});
});

describe('close', () => {
	test('Quits the subscribing connection only and drops the handlers', async () => {
		// 1. The publishing client belongs to the caller and stays open; the duplicate and its subscriptions go
		mockSubRedis.status = 'ready';
		bus['handlers'].set(mockNamespacedChannel, new Set([mockHandler]));

		await bus.close();

		expect(bus['sub'].quit).toHaveBeenCalledOnce();
		expect(bus['sub'].disconnect).not.toHaveBeenCalled();
		expect(bus['pub'].quit).not.toHaveBeenCalled();
		expect(bus['handlers']).toEqual(new Map());
	});

	test('Disconnects the subscribing connection without a QUIT when it never reached ready', async () => {
		// 1. The duplicate connects lazily on its first SUBSCRIBE; one that never got one — an unreachable Redis —
		//    must be dropped with `disconnect`, since `quit` would reconnect forever to deliver QUIT and hang the close
		mockSubRedis.status = 'connecting';

		await bus.close();

		expect(bus['sub'].disconnect).toHaveBeenCalledOnce();
		expect(bus['sub'].quit).not.toHaveBeenCalled();
	});
});

describe('message order', () => {
	test('Hands messages to the subscribers in the order Redis sent them, even when one needs decompressing', async () => {
		// 1. A gzipped message decompresses asynchronously; a plain one right behind it must not overtake it
		const seen: unknown[] = [];
		bus['handlers'] = new Map([[mockNamespacedChannel, new Set([(payload: unknown) => void seen.push(payload)])]]);

		vi.mocked(isCompressed).mockReturnValueOnce(true).mockReturnValueOnce(false);

		vi.mocked(decompress).mockImplementationOnce(
			() => new Promise((resolve) => setTimeout(() => resolve(mockDecompressedUint8Array), 5)),
		);

		vi.mocked(deserialize).mockReturnValueOnce('first').mockReturnValueOnce('second');

		// 2. Both messages arrive through the listener the constructor registered, back to back
		const listener = vi.mocked(mockSubRedis.on).mock.calls.find(([event]) => event === 'messageBuffer')![1] as (
			channel: Buffer,
			message: Buffer,
		) => void;

		listener(mockNamespacedChannelBuffer, mockBuffer);
		listener(mockNamespacedChannelBuffer, mockBuffer);

		await bus['inbox'];
		expect(seen).toStrictEqual(['first', 'second']);
	});

	test('Survives a throwing logger, so a message it cannot report skips no later message', async () => {
		// 1. An undecodable message is reported through the logger; a logger that throws on that report must neither
		//    be left as an unhandled rejection nor turn the inbox chain rejected, which would silently skip every
		//    message after it
		const seen: unknown[] = [];
		bus['handlers'] = new Map([[mockNamespacedChannel, new Set([(payload: unknown) => void seen.push(payload)])]]);

		mockWarn.mockImplementationOnce(() => {
			throw new Error('logger down');
		});

		vi.mocked(deserialize)
			.mockImplementationOnce(() => {
				throw new SyntaxError('not JSON');
			})
			.mockReturnValueOnce('second');

		// 2. Both messages arrive through the listener the constructor registered, back to back
		const listener = vi.mocked(mockSubRedis.on).mock.calls.find(([event]) => event === 'messageBuffer')![1] as (
			channel: Buffer,
			message: Buffer,
		) => void;

		listener(mockNamespacedChannelBuffer, mockBuffer);
		listener(mockNamespacedChannelBuffer, mockBuffer);

		// 3. The inbox settles and the second message still reached its subscriber
		await expect(bus['inbox']).resolves.toBeUndefined();
		expect(seen).toStrictEqual(['second']);
	});
});

describe('#messageBufferHandler', () => {
	test('Returns early if no handlers are registered for channel', async () => {
		// 1. A message for a channel nobody subscribed to is not even decoded
		bus['handlers'] = new Map();

		await bus['messageBufferHandler'](mockNamespacedChannelBuffer, mockBuffer);

		expect(deserialize).not.toHaveBeenCalled();
	});

	test('Calls all registered handlers for channel with deserialized message', async () => {
		// 1. The handler receives the decoded value, not the bytes
		bus['handlers'] = new Map([[mockNamespacedChannel, new Set([mockHandler])]]);

		await bus['messageBufferHandler'](mockNamespacedChannelBuffer, mockBuffer);

		expect(mockHandler).toHaveBeenCalledWith(mockMessage);
	});

	test('Skips decompression if compression is disabled', async () => {
		// 1. With compression off, bytes that look gzipped are still taken as they are
		bus = new BusDriverRedis({
			redis: mockRedis,
			namespace: 'test-namespace',
			compression: false,
		});

		bus['handlers'] = new Map([[mockNamespacedChannel, new Set([mockHandler])]]);

		await bus['messageBufferHandler'](mockNamespacedChannelBuffer, mockBuffer);

		expect(decompress).not.toHaveBeenCalled();
	});

	test('Decompresses binary if value is compressed and compression is enabled', async () => {
		// 1. Compression is decided per message on publish, so it is detected from the bytes, not from the config alone
		bus = new BusDriverRedis({
			redis: mockRedis,
			namespace: 'test-namespace',
			compression: true,
		});

		bus['handlers'] = new Map([[mockNamespacedChannel, new Set([mockHandler])]]);

		await bus['messageBufferHandler'](mockNamespacedChannelBuffer, mockBuffer);

		expect(decompress).toHaveBeenCalledWith(mockUint8Array);
		expect(deserialize).toHaveBeenCalledWith(mockDecompressedUint8Array);
	});

	test('Logs a message it cannot decode instead of rejecting, and calls no handler', async () => {
		// 1. A foreign client publishing plain text on the channel, or a truncated gzip: the listener is fire-and-forget,
		//    so a rejection here would be unhandled and end the process
		bus['handlers'] = new Map([[mockNamespacedChannel, new Set([mockHandler])]]);

		vi.mocked(deserialize).mockImplementationOnce(() => {
			throw new SyntaxError('not JSON');
		});

		await expect(bus['messageBufferHandler'](mockNamespacedChannelBuffer, mockBuffer)).resolves.toBeUndefined();

		// 2. The failure is reported as unreadable, not as a subscriber's fault
		expect(mockHandler).not.toHaveBeenCalled();
		expect(reportUnreadable).toHaveBeenCalledWith(mockNamespacedChannel, expect.any(SyntaxError));
	});
});
