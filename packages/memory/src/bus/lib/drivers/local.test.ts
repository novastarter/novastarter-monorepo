/**
 * Tests of `memory/bus/lib/drivers/local`.
 */
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BusDriverLocal } from './local.js';

vi.mock('@novastarter/logger', () => {
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
		const mockChannel = 'mock-channel';
		const mockPayload = { hello: 'world' };

		await bus.publish(mockChannel, mockPayload);
	});

	test('Calls each registered callback of the channel with the given payload', async () => {
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

		for (const handler of mockHandlers) {
			expect(handler).toBeCalledWith(mockPayload);
		}

		expect(useLogger().warn).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'bad news' }),
			`A subscriber of bus channel "${mockChannel}" failed`,
		);
	});
});

describe('subscribe', () => {
	test('Creates new set with the passed callback if handler set does not exist yet', async () => {
		const mockChannel = 'mock-channel';
		const mockHandler = vi.fn();

		await bus.subscribe(mockChannel, mockHandler);

		expect(bus['handlers'].get(mockChannel)).toBeInstanceOf(Set);
		expect(bus['handlers'].get(mockChannel)?.size).toBe(1);
		expect(bus['handlers'].get(mockChannel)?.values().next().value).toBe(mockHandler);
	});

	test('Adds callback handler if set already exists', async () => {
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
		const mockChannel = 'mock-channel';
		const mockHandler = vi.fn();

		await bus.unsubscribe(mockChannel, mockHandler);
	});

	test('Removes the handler from the existing', async () => {
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
});

describe('payload', () => {
	test("Hands subscribers a serialised copy, as the Redis bus would, not the publisher's object", async () => {
		const handler = vi.fn();
		const payload = { count: 1, at: new Date('2026-01-01T00:00:00.000Z'), missing: undefined };

		await bus.subscribe('channel', handler);
		await bus.publish('channel', payload);

		// 1. A copy, and one that went through the wire format: the `Date` is a string, the `undefined` field is gone
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
