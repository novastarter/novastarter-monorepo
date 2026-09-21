/**
 * Tests of `emitter/lib/emitter`.
 *
 * `@novastarter/logger` is mocked, so failing handlers can be asserted on without output.
 */
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Emitter } from './emitter.js';

vi.mock('@novastarter/logger');

let emitter: Emitter;

const logger = { warn: vi.fn() };

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(logger as any);
	emitter = new Emitter();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('emitFilter', () => {
	test('Returns the payload untouched without handlers', async () => {
		const payload = { title: 'a' };

		expect(await emitter.emitFilter('items.create', payload, {})).toBe(payload);
	});

	test('Runs handlers in order, each seeing the previous result', async () => {
		emitter.onFilter<string[]>('items.create', (payload) => [...payload, 'first']);
		emitter.onFilter<string[]>('items.create', (payload) => [...payload, 'second']);

		expect(await emitter.emitFilter('items.create', [], {})).toStrictEqual(['first', 'second']);
	});

	test('Keeps the payload when a handler returns undefined', async () => {
		const handler = vi.fn();
		emitter.onFilter('items.create', handler);

		expect(await emitter.emitFilter('items.create', 'payload', {})).toBe('payload');
		expect(handler).toHaveBeenCalledOnce();
	});

	test('Passes the event name in meta and an anonymous context by default', async () => {
		const handler = vi.fn();
		emitter.onFilter('items.create', handler);

		await emitter.emitFilter('items.create', 'payload', { collection: 'articles' });

		expect(handler).toHaveBeenCalledWith(
			'payload',
			{ event: 'items.create', collection: 'articles' },
			{ accountability: null },
		);
	});

	test('Passes the given context through', async () => {
		const handler = vi.fn();
		const context = { accountability: { user: 'u1' } as any, database: 'db' };
		emitter.onFilter('items.create', handler);

		await emitter.emitFilter('items.create', 'payload', {}, context);

		expect(handler).toHaveBeenCalledWith('payload', expect.anything(), context);
	});

	test('Runs several events one after another', async () => {
		emitter.onFilter<string>('a', (payload) => payload + 'a');
		emitter.onFilter<string>('b', (payload) => payload + 'b');

		expect(await emitter.emitFilter(['a', 'b'], '', {})).toBe('ab');
	});

	test('Matches wildcard subscriptions', async () => {
		emitter.onFilter<string>('items.*.create', (payload) => payload + '!');

		expect(await emitter.emitFilter('items.articles.create', 'x', {})).toBe('x!');
	});

	test('Propagates a handler error', async () => {
		emitter.onFilter('items.create', () => {
			throw new Error('nope');
		});

		await expect(emitter.emitFilter('items.create', 'payload', {})).rejects.toThrow('nope');
	});
});

describe('emitAction', () => {
	test('Calls handlers with meta and default context', async () => {
		const handler = vi.fn();
		emitter.onAction('items.create', handler);

		emitter.emitAction('items.create', { key: 1 });
		await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

		expect(handler).toHaveBeenCalledWith({ event: 'items.create', key: 1 }, { accountability: null });
	});

	test('Logs a warning instead of rejecting when an async handler fails', async () => {
		const error = new Error('boom');

		// A rejected promise is what emitAsync guards against; a synchronous throw escapes eventemitter2 as is
		emitter.onAction('items.create', async () => {
			throw error;
		});

		expect(() => emitter.emitAction('items.create', {})).not.toThrow();

		await vi.waitFor(() =>
			expect(logger.warn).toHaveBeenCalledWith(error, 'An error was thrown while executing action "items.create"'),
		);
	});

	test('Logs a handler that throws synchronously and still runs the handlers after it', async () => {
		// eventemitter2 calls the handlers in a plain loop: unwrapped, a throw before the first `await` would escape
		// `emitAsync` and skip every handler registered after the throwing one
		const error = new Error('sync boom');
		const after = vi.fn();

		emitter.onAction('items.create', () => {
			throw error;
		});

		emitter.onAction('items.create', after);

		expect(() => emitter.emitAction('items.create', {})).not.toThrow();

		await vi.waitFor(() =>
			expect(logger.warn).toHaveBeenCalledWith(error, 'An error was thrown while executing action "items.create"'),
		);

		expect(after).toHaveBeenCalledOnce();
	});

	test('offAction removes the handler onAction registered', async () => {
		const handler = vi.fn();

		emitter.onAction('items.create', handler);
		emitter.offAction('items.create', handler);
		emitter.emitAction('items.create', {});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(handler).not.toHaveBeenCalled();
	});

	test('Wraps a thrown non-Error so its text reaches the log', async () => {
		// A string in first position would be pino's message and the text after it dropped; `toError` keeps both
		emitter.onAction('items.create', async () => {
			throw 'nope';
		});

		emitter.emitAction('items.create', {});

		await vi.waitFor(() =>
			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'nope', cause: 'nope' }),
				'An error was thrown while executing action "items.create"',
			),
		);
	});

	test('Fires every event of a list', async () => {
		const handler = vi.fn();
		emitter.onAction('a', handler);
		emitter.onAction('b', handler);

		emitter.emitAction(['a', 'b'], {});

		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
	});
});

describe('emitInit', () => {
	test('Waits for the handlers', async () => {
		const order: string[] = [];

		emitter.onInit('app.before', async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			order.push('handler');
		});

		await emitter.emitInit('app.before', {});
		order.push('after');

		expect(order).toStrictEqual(['handler', 'after']);
	});

	test('Logs a warning instead of throwing when a handler fails', async () => {
		const error = new Error('boom');

		emitter.onInit('app.before', () => {
			throw error;
		});

		await expect(emitter.emitInit('app.before', {})).resolves.toBeUndefined();

		expect(logger.warn).toHaveBeenCalledWith(error, 'An error was thrown while executing init "app.before"');
	});

	test('Wraps a thrown non-Error so its text reaches the log', async () => {
		emitter.onInit('app.before', () => {
			throw 'nope';
		});

		await expect(emitter.emitInit('app.before', {})).resolves.toBeUndefined();

		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'nope', cause: 'nope' }),
			'An error was thrown while executing init "app.before"',
		);
	});
});

describe('subscriptions', () => {
	test('Counts listeners per channel', () => {
		const handler = vi.fn();

		emitter.onFilter('x', handler);
		emitter.onAction('x', handler);
		emitter.onAction('x', handler);
		emitter.onInit('x', handler);

		expect(emitter.countFilterListeners('x')).toBe(1);
		expect(emitter.countActionListeners('x')).toBe(2);
		expect(emitter.countInitListeners('x')).toBe(1);
	});

	test('Removes a single handler', () => {
		const handler = vi.fn();

		emitter.onFilter('x', handler);
		emitter.onAction('x', handler);
		emitter.onInit('x', handler);

		emitter.offFilter('x', handler);
		emitter.offAction('x', handler);
		emitter.offInit('x', handler);

		expect(emitter.countFilterListeners('x')).toBe(0);
		expect(emitter.countActionListeners('x')).toBe(0);
		expect(emitter.countInitListeners('x')).toBe(0);
	});

	test('Removes every handler of every channel', () => {
		emitter.onFilter('x', vi.fn());
		emitter.onAction('y', vi.fn());
		emitter.onInit('z', vi.fn());

		emitter.offAll();

		expect(emitter.countFilterListeners('x')).toBe(0);
		expect(emitter.countActionListeners('y')).toBe(0);
		expect(emitter.countInitListeners('z')).toBe(0);
	});
});
