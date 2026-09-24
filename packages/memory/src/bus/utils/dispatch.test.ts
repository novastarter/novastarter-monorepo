/**
 * Tests of `memory/bus/utils/dispatch`: every handler runs, failures are logged, sync and async alike.
 */
import { useLogger } from '@novastarter/logger';
import { afterEach, expect, test, vi } from 'vitest';
import { dispatch, reportUnreadable } from './dispatch.js';

vi.mock('@novastarter/logger', () => {
	// One logger object for the whole file, so the assertions can read the calls `dispatch` made on it
	const logger = { warn: vi.fn() };

	return { useLogger: () => logger };
});

afterEach(() => {
	vi.clearAllMocks();
});

test('Does nothing without handlers', () => {
	// A channel nobody subscribed to: no call, no log line
	expect(() => dispatch('channel', undefined, 'payload')).not.toThrow();
	expect(useLogger().warn).not.toHaveBeenCalled();
});

test('Calls every handler with the payload, even after one throws', () => {
	// The first handler throws synchronously; the second one must still run
	const failing = vi.fn(() => {
		throw new Error('boom');
	});

	const fine = vi.fn();

	dispatch('channel', new Set([failing, fine]), { a: 1 });

	// The failure is a log line, not an exception of the caller
	expect(fine).toHaveBeenCalledWith({ a: 1 });

	expect(useLogger().warn).toHaveBeenCalledWith(
		expect.objectContaining({ message: 'boom' }),
		'A subscriber of bus channel "channel" failed',
	);
});

test('Logs an async rejection instead of leaving it unhandled, wrapping a thrown string', async () => {
	// A rejection with a bare string: nobody awaits a subscriber, so it is caught here or nowhere
	dispatch('channel', [async () => Promise.reject('nope')], 'payload');

	// `toError` wraps the string so the log line still carries an `Error`
	await vi.waitFor(() =>
		expect(useLogger().warn).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'nope', cause: 'nope' }),
			'A subscriber of bus channel "channel" failed',
		),
	);
});

test('Logs a subscriber that keeps failing once, and again only after it recovered', async () => {
	// Two failures in a row: one line. The log may itself travel over the bus, so a `logs` subscriber that throws on
	// every message must not be able to feed itself a message per failure
	let fail = true;

	const flaky = vi.fn(() => {
		if (fail) throw new Error('down');
	});

	dispatch('logs', [flaky], 'a');
	dispatch('logs', [flaky], 'b');
	await vi.waitFor(() => expect(flaky).toHaveBeenCalledTimes(2));
	expect(useLogger().warn).toHaveBeenCalledTimes(1);

	// A success clears the record, so the next failure is news again
	fail = false;
	dispatch('logs', [flaky], 'c');
	await vi.waitFor(() => expect(flaky).toHaveBeenCalledTimes(3));

	fail = true;
	dispatch('logs', [flaky], 'd');
	await vi.waitFor(() => expect(useLogger().warn).toHaveBeenCalledTimes(2));
});

test('Tracks failures per subscriber and per channel', async () => {
	// Two subscribers failing on one channel: a line each
	const a = vi.fn(() => {
		throw new Error('a');
	});

	const b = vi.fn(() => {
		throw new Error('b');
	});

	dispatch('channel', [a, b], 'payload');
	await vi.waitFor(() => expect(useLogger().warn).toHaveBeenCalledTimes(2));

	// The same subscriber failing on another channel is news for that channel, but not again on the first
	dispatch('other', [a], 'payload');
	dispatch('channel', [a], 'payload');
	await vi.waitFor(() => expect(a).toHaveBeenCalledTimes(3));
	expect(useLogger().warn).toHaveBeenCalledTimes(3);
	expect(useLogger().warn).toHaveBeenLastCalledWith(expect.anything(), 'A subscriber of bus channel "other" failed');
});

test('Fans out over a snapshot, so a handler added during delivery does not receive the current message', () => {
	// The drivers hand in their live `Set`; a handler that subscribes another one from inside adds to it while it is
	// being walked, and a `Set` visits entries added during iteration
	const handlers = new Set<() => void>();
	const late = vi.fn();

	const early = vi.fn(() => {
		handlers.add(late);
	});

	handlers.add(early);
	dispatch('channel', handlers, 'payload');

	// The newcomer is in the set for the next message, but was not called for this one
	expect(early).toHaveBeenCalledOnce();
	expect(late).not.toHaveBeenCalled();
	expect(handlers.has(late)).toBe(true);
});

test('Calls a handler that removes and re-adds itself once, not without end', () => {
	// Deleting and re-adding an entry during iteration makes a `Set` visit it again, so a handler re-arming itself
	// would be called for the same message for ever; the guard turns that into a failed assertion instead of a hang
	const handlers = new Set<() => void>();

	const rearming = vi.fn(() => {
		if (rearming.mock.calls.length > 5) {
			throw new Error('called again for the same message');
		}

		handlers.delete(rearming);
		handlers.add(rearming);
	});

	handlers.add(rearming);
	dispatch('channel', handlers, 'payload');

	expect(rearming).toHaveBeenCalledOnce();
	expect(useLogger().warn).not.toHaveBeenCalled();
});

test('reportUnreadable logs every unreadable message', () => {
	// Not a subscriber's fault, so the once-per-failure rule does not apply: two messages, two lines
	reportUnreadable('channel', new Error('not gzip'));
	reportUnreadable('channel', new Error('not gzip'));

	expect(useLogger().warn).toHaveBeenCalledTimes(2);

	expect(useLogger().warn).toHaveBeenCalledWith(
		expect.objectContaining({ message: 'not gzip' }),
		'A message on bus channel "channel" could not be read',
	);
});
