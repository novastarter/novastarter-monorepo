/**
 * Tests of `memory/bus/utils/dispatch`: every handler runs, failures are logged, sync and async alike.
 */
import { useLogger } from '@novastarter/logger';
import { afterEach, expect, test, vi } from 'vitest';
import { dispatch, reportUnreadable } from './dispatch.js';

vi.mock('@novastarter/logger', () => {
	const logger = { warn: vi.fn() };
	return { useLogger: () => logger };
});

afterEach(() => {
	vi.clearAllMocks();
});

test('Does nothing without handlers', () => {
	expect(() => dispatch('channel', undefined, 'payload')).not.toThrow();
	expect(useLogger().warn).not.toHaveBeenCalled();
});

test('Calls every handler with the payload, even after one throws', () => {
	const failing = vi.fn(() => {
		throw new Error('boom');
	});

	const fine = vi.fn();

	dispatch('channel', new Set([failing, fine]), { a: 1 });

	expect(fine).toHaveBeenCalledWith({ a: 1 });

	expect(useLogger().warn).toHaveBeenCalledWith(
		expect.objectContaining({ message: 'boom' }),
		'A subscriber of bus channel "channel" failed',
	);
});

test('Logs an async rejection instead of leaving it unhandled, wrapping a thrown string', async () => {
	dispatch('channel', [async () => Promise.reject('nope')], 'payload');

	await vi.waitFor(() =>
		expect(useLogger().warn).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'nope', cause: 'nope' }),
			'A subscriber of bus channel "channel" failed',
		),
	);
});

test('Logs a subscriber that keeps failing once, and again only after it recovered', async () => {
	// 1. Two failures in a row: one line. The log may itself travel over the bus, so a `logs` subscriber that throws
	//    on every message must not be able to feed itself a message per failure
	let fail = true;

	const flaky = vi.fn(() => {
		if (fail) throw new Error('down');
	});

	dispatch('logs', [flaky], 'a');
	dispatch('logs', [flaky], 'b');
	await vi.waitFor(() => expect(flaky).toHaveBeenCalledTimes(2));
	expect(useLogger().warn).toHaveBeenCalledTimes(1);

	// 2. A success clears the record, so the next failure is news again
	fail = false;
	dispatch('logs', [flaky], 'c');
	await vi.waitFor(() => expect(flaky).toHaveBeenCalledTimes(3));

	fail = true;
	dispatch('logs', [flaky], 'd');
	await vi.waitFor(() => expect(useLogger().warn).toHaveBeenCalledTimes(2));
});

test('Tracks failures per subscriber, not per channel', async () => {
	const a = vi.fn(() => {
		throw new Error('a');
	});

	const b = vi.fn(() => {
		throw new Error('b');
	});

	dispatch('channel', [a, b], 'payload');
	await vi.waitFor(() => expect(useLogger().warn).toHaveBeenCalledTimes(2));
});

test('reportUnreadable logs every unreadable message', () => {
	reportUnreadable('channel', new Error('not gzip'));
	reportUnreadable('channel', new Error('not gzip'));

	expect(useLogger().warn).toHaveBeenCalledTimes(2);

	expect(useLogger().warn).toHaveBeenCalledWith(
		expect.objectContaining({ message: 'not gzip' }),
		'A message on bus channel "channel" could not be read',
	);
});
