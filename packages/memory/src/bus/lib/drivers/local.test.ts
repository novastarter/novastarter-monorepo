/**
 * Tests of `memory/bus/lib/drivers/local`.
 */
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BusDriverLocal } from './local.js';

vi.mock('@novastarter/logger', () => {
	// One logger object for the whole file, so the assertions can read the calls `dispatch` made on it
	const logger = { warn: vi.fn() };

	return { useLogger: () => logger };
});

let bus: BusDriverLocal;

beforeEach(() => {
	bus = new BusDriverLocal({});
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('publish', () => {
	test('Is a no-op when no handlers are registered for channel', async () => {
		// Nobody listening: nothing is delivered and nothing fails
		const mockChannel = 'mock-channel';
		const mockPayload = { hello: 'world' };

		await expect(bus.publish(mockChannel, mockPayload)).resolves.toBeUndefined();
	});

	test('Calls each registered callback of the channel with the given payload', async () => {
		// Two handlers registered directly, so the test exercises `publish` alone
		const mockChannel = 'mock-channel';
		const mockPayload = { hello: 'world' };
		const mockHandlers = [vi.fn(), vi.fn()];

		bus['handlers'].set(mockChannel, new Set(mockHandlers));

		await bus.publish(mockChannel, mockPayload);

		for (const handler of mockHandlers) {
			expect(handler).toBeCalledWith(mockPayload);
		}
	});

	test('Logs errors thrown in the registered callbacks and still calls the others', async () => {
		// The first handler throws; the second one must still be reached
		const mockChannel = 'mock-channel';
		const mockPayload = { hello: 'world' };

		const mockHandlers = [
			vi.fn().mockImplementation(() => {
				throw new Error('bad news');
			}),
			vi.fn(),
		];

		bus['handlers'].set(mockChannel, new Set(mockHandlers));

		await bus.publish(mockChannel, mockPayload);

		// Both ran, and the failure went to the log rather than to the publisher
		for (const handler of mockHandlers) {
			expect(handler).toBeCalledWith(mockPayload);
		}

		expect(useLogger().warn).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'bad news' }),
			`A subscriber of bus channel "${mockChannel}" failed`,
		);
	});

	test('Rejects a payload that cannot be serialised even when nobody listens, as the Redis bus does', async () => {
		// A `BigInt` has no JSON form; on the Redis bus the publish fails at once, so it must here as well, not only
		// from the moment the first subscriber appears
		await expect(bus.publish('mock-channel', { n: 1n })).rejects.toThrow(TypeError);
	});
});

describe('subscribe', () => {
	test('Creates new set with the passed callback if handler set does not exist yet', async () => {
		// The first subscriber of a channel creates its set
		const mockChannel = 'mock-channel';
		const mockHandler = vi.fn();

		await bus.subscribe(mockChannel, mockHandler);

		expect(bus['handlers'].get(mockChannel)).toBeInstanceOf(Set);
		expect(bus['handlers'].get(mockChannel)?.size).toBe(1);
		expect(bus['handlers'].get(mockChannel)?.values().next().value).toBe(mockHandler);
	});

	test('Adds callback handler if set already exists', async () => {
		// A later subscriber joins the existing set, behind the earlier one
		const mockChannel = 'mock-channel';
		const existingHandler = vi.fn();
		const mockHandler = vi.fn();

		bus['handlers'].set(mockChannel, new Set([existingHandler]));

		await bus.subscribe(mockChannel, mockHandler);

		expect(bus['handlers'].get(mockChannel)).toBeInstanceOf(Set);
		expect(bus['handlers'].get(mockChannel)?.size).toBe(2);

		const handlers = Array.from(bus['handlers'].get(mockChannel)!);
		expect(handlers[0]).toBe(existingHandler);
		expect(handlers[1]).toBe(mockHandler);
	});
});

describe('unsubscribe', () => {
	test('Is a no-op if channel does not exist', async () => {
		// An unknown channel is not an error
		const mockChannel = 'mock-channel';
		const mockHandler = vi.fn();

		await expect(bus.unsubscribe(mockChannel, mockHandler)).resolves.toBeUndefined();
	});

	test('Removes the handler from the existing', async () => {
		// With another subscriber left, the channel and its set stay
		const mockChannel = 'mock-channel';
		const existingHandler = vi.fn();
		const mockHandler = vi.fn();

		bus['handlers'].set(mockChannel, new Set([existingHandler, mockHandler]));

		await bus.unsubscribe(mockChannel, mockHandler);

		expect(bus['handlers'].get(mockChannel)).toBeInstanceOf(Set);
		expect(bus['handlers'].get(mockChannel)?.size).toBe(1);

		const handlers = Array.from(bus['handlers'].get(mockChannel)!);
		expect(handlers[0]).toBe(existingHandler);
	});

	test('Drops the channel with its last handler, so a channel per request does not grow the map', async () => {
		// A request/reply pattern subscribes and unsubscribes a fresh channel per request; every one of them would
		// otherwise leave an empty set behind for the life of the process
		const handler = vi.fn();

		for (let i = 0; i < 10; i++) {
			await bus.subscribe(`reply:${i}`, handler);
			await bus.unsubscribe(`reply:${i}`, handler);
		}

		expect(bus['handlers'].size).toBe(0);
	});
});

describe('payload', () => {
	test("Hands subscribers a serialised copy, as the Redis bus would, not the publisher's object", async () => {
		// A payload with values the wire cannot carry as they are
		const handler = vi.fn();
		const payload = { count: 1, at: new Date('2026-01-01T00:00:00.000Z'), missing: undefined };

		await bus.subscribe('channel', handler);
		await bus.publish('channel', payload);

		// A copy, and one that went through the wire format: the `Date` is a string, the `undefined` field is gone
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0]![0]).not.toBe(payload);
		expect(handler.mock.calls[0]![0]).toStrictEqual({ count: 1, at: '2026-01-01T00:00:00.000Z' });
	});
});

describe('channel names', () => {
	test('Treats a channel named like an Object.prototype member as a channel', async () => {
		// A plain object as the registry would answer `toString` with the inherited function instead of a set
		const handler = vi.fn();

		await bus.subscribe('toString', handler);
		await bus.publish('toString', 'payload');
		await bus.unsubscribe('toString', handler);

		expect(handler).toHaveBeenCalledWith('payload');
	});
});

describe('subscribing from a handler', () => {
	test('A handler subscribed from inside another one receives the next message, not the one being delivered', async () => {
		// The first handler subscribes a second one while the message is being fanned out; a live `Set` would visit the
		// newcomer with the very message it was subscribed after
		const seen: string[] = [];
		const second = vi.fn(() => void seen.push('second'));

		const first = vi.fn(() => {
			seen.push('first');
			void bus.subscribe('channel', second);
		});

		await bus.subscribe('channel', first);
		await bus.publish('channel', 1);

		expect(seen).toStrictEqual(['first']);

		// From the next message on, both are subscribers
		await bus.publish('channel', 2);

		expect(seen).toStrictEqual(['first', 'first', 'second']);
	});

	test('A handler that re-arms itself runs once per message', async () => {
		// Unsubscribing and re-subscribing from inside puts the handler back into the live `Set`, which would visit it
		// again for the same message, without end
		let calls = 0;

		const handler = (): void => {
			calls++;

			if (calls > 5) {
				throw new Error('called again for the same message');
			}

			void bus.unsubscribe('channel', handler);
			void bus.subscribe('channel', handler);
		};

		await bus.subscribe('channel', handler);
		await bus.publish('channel', 1);

		expect(calls).toBe(1);
	});
});
