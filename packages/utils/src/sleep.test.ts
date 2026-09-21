/**
 * Tests of `utils/sleep`: resolves after the given time, rejects early on abort.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { sleep } from './sleep.js';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

test('Resolves once the time is up, not before', async () => {
	// 1. The promise stays pending short of the deadline and settles exactly at it
	const settled = vi.fn();
	const wait = sleep(1000).then(settled);

	await vi.advanceTimersByTimeAsync(999);
	expect(settled).not.toHaveBeenCalled();

	await vi.advanceTimersByTimeAsync(1);
	await wait;
	expect(settled).toHaveBeenCalledOnce();
});

test('Rejects with the abort reason when the signal aborts during the wait', async () => {
	// 1. Aborting mid-wait ends it at once with the signal's reason, and the timer is gone
	const controller = new AbortController();
	const wait = sleep(10_000, controller.signal);

	await vi.advanceTimersByTimeAsync(10);
	controller.abort(new Error('shutting down'));

	await expect(wait).rejects.toThrow('shutting down');
	expect(vi.getTimerCount()).toBe(0);
});

test('Rejects at once with a signal already aborted', async () => {
	// 1. No timer is armed when there is nothing to wait for
	const controller = new AbortController();
	controller.abort(new Error('already'));

	await expect(sleep(10_000, controller.signal)).rejects.toThrow('already');
	expect(vi.getTimerCount()).toBe(0);
});

test('Ignores an abort after the wait ended', async () => {
	// 1. The abort listener is removed on resolution, so a late abort finds nothing to reject
	const controller = new AbortController();
	const wait = sleep(100, controller.signal);

	await vi.advanceTimersByTimeAsync(100);
	await expect(wait).resolves.toBeUndefined();

	controller.abort();
});
