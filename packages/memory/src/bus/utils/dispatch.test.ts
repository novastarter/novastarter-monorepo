/**
 * Tests of `memory/bus/utils/dispatch`: every handler runs, failures are logged, sync and async alike.
 */
import { useLogger } from '@novastarter/logger';
import { afterEach, expect, test, vi } from 'vitest';
import { dispatch } from './dispatch.js';

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
