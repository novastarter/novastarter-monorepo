/**
 * Tests of `utils/sleep`: resolves after the given time, rejects early on abort.
 */
import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MAX_TIMER_DELAY, sleep } from './sleep.js';

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

test('Removes its abort listener once the wait ended, so a long-lived signal keeps no reference', async () => {
	// 1. The listener is there while the wait runs and gone on resolution, so a late abort finds nothing to call and a
	//    signal shared by many waits does not accumulate one listener per finished wait
	const controller = new AbortController();
	const wait = sleep(100, controller.signal);

	expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);

	await vi.advanceTimersByTimeAsync(100);
	await expect(wait).resolves.toBeUndefined();

	expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
	controller.abort();
});

test('Refuses a wait the timer cannot hold instead of ending it at once', async () => {
	// 1. Negative, NaN and overlong delays would all become a 1 ms timer in Node; each is a RangeError instead
	await expect(sleep(-1)).rejects.toThrow(RangeError);
	await expect(sleep(Number.NaN)).rejects.toThrow(RangeError);
	await expect(sleep(MAX_TIMER_DELAY + 1)).rejects.toThrow(RangeError);
	expect(vi.getTimerCount()).toBe(0);

	// 2. The bounds themselves are fine
	const zero = sleep(0);
	const max = sleep(MAX_TIMER_DELAY);

	await vi.advanceTimersByTimeAsync(0);
	await expect(zero).resolves.toBeUndefined();
	expect(vi.getTimerCount()).toBe(1);

	await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY);
	await expect(max).resolves.toBeUndefined();
});
