/**
 * Tests of `utils/withTimeout`: settles with the operation in time, gives up at the deadline or on abort, cleans up.
 */
import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MAX_TIMER_DELAY } from './sleep.js';
import { TimeoutError, withTimeout } from './with-timeout.js';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

/**
 * Promise that resolves with a value after a delay, so each test decides whether the deadline or the work comes first.
 *
 * @param ms - Delay before resolution.
 * @param value - What it resolves to.
 * @returns The pending promise.
 */
const resolveAfter = <T>(ms: number, value: T): Promise<T> => {
	return new Promise((resolve) => {
		// 1. A plain timer, driven by the fake clock like the deadline it races
		setTimeout(() => resolve(value), ms);
	});
};

test('Resolves with the value when the operation finishes before the deadline', async () => {
	// 1. The work takes 100 ms of a 1000 ms budget; the value comes through and the deadline timer is gone
	const wait = withTimeout(resolveAfter(100, 'ok'), 1000);

	await vi.advanceTimersByTimeAsync(100);
	await expect(wait).resolves.toBe('ok');
	expect(vi.getTimerCount()).toBe(0);
});

test('Rejects with what the operation rejected with', async () => {
	// 1. The operation's own error comes through untouched, and the deadline timer is cleared with it
	const wait = withTimeout(Promise.reject(new Error('boom')), 1000);

	await expect(wait).rejects.toThrow('boom');
	expect(vi.getTimerCount()).toBe(0);
});

test('Rejects with a TimeoutError once the deadline passes, not before', async () => {
	// 1. The work never finishes; the promise stays pending short of the deadline and fails exactly at it
	const settled = vi.fn();
	const wait = withTimeout(new Promise<never>(() => {}), 1000);
	const outcome = wait.catch((error: unknown) => error);

	outcome.then(settled);

	await vi.advanceTimersByTimeAsync(999);
	expect(settled).not.toHaveBeenCalled();

	await vi.advanceTimersByTimeAsync(1);
	const error = await outcome;

	expect(error).toBeInstanceOf(TimeoutError);
	expect(error).toMatchObject({ name: 'TimeoutError', message: 'Timed out after 1000 ms', ms: 1000 });
});

test('Rejects with what the error factory makes, given the deadline', async () => {
	// 1. The factory sees the limit and its result is what the caller gets, so a package throws its own error class
	const error = vi.fn((ms: number) => new RangeError(`too slow: ${ms}`));
	const wait = withTimeout(new Promise<never>(() => {}), 500, { error });
	const outcome = wait.catch((cause: unknown) => cause);

	await vi.advanceTimersByTimeAsync(500);

	await expect(outcome).resolves.toEqual(new RangeError('too slow: 500'));
	expect(error).toHaveBeenCalledWith(500);
});

test('Rejects with what the error factory throws instead of crashing the timer', async () => {
	// 1. A factory that throws is a bug in the caller; it surfaces as the rejection, not as an uncaught exception
	const wait = withTimeout(new Promise<never>(() => {}), 500, {
		error: () => {
			throw new Error('factory bug');
		},
	});

	const outcome = wait.catch((cause: unknown) => cause);

	await vi.advanceTimersByTimeAsync(500);

	await expect(outcome).resolves.toEqual(new Error('factory bug'));
	expect(vi.getTimerCount()).toBe(0);
});

test('Hands a function operation a signal that aborts with the timeout error at the deadline', async () => {
	// 1. The function starts the work with the signal; on timeout the signal's reason is the same error the caller
	//    gets, so a `fetch` given that signal stops for the reason the caller sees
	let received: AbortSignal | undefined;

	const operation = vi.fn((signal: AbortSignal) => {
		received = signal;
		return new Promise<never>(() => {});
	});

	const wait = withTimeout(operation, 200);
	const outcome = wait.catch((cause: unknown) => cause);

	expect(operation).toHaveBeenCalledOnce();
	expect(received?.aborted).toBe(false);

	await vi.advanceTimersByTimeAsync(200);

	const error = await outcome;
	expect(error).toBeInstanceOf(TimeoutError);
	expect(received?.aborted).toBe(true);
	expect(received?.reason).toBe(error);
});

test('Rejects with the abort reason when the outer signal aborts during the wait, aborting the inner signal too', async () => {
	// 1. Aborting mid-wait ends it at once with the signal's reason, passes the reason to the operation's signal and
	//    drops the deadline timer
	const controller = new AbortController();
	let received: AbortSignal | undefined;

	const wait = withTimeout(
		(signal) => {
			received = signal;
			return new Promise<never>(() => {});
		},
		10_000,
		{ signal: controller.signal },
	);

	const outcome = wait.catch((cause: unknown) => cause);

	await vi.advanceTimersByTimeAsync(10);
	controller.abort(new Error('shutting down'));

	await expect(outcome).resolves.toEqual(new Error('shutting down'));
	expect(received?.aborted).toBe(true);
	expect(received?.reason).toEqual(new Error('shutting down'));
	expect(vi.getTimerCount()).toBe(0);
});

test('Rejects at once with a signal already aborted, without starting the operation', async () => {
	// 1. No timer is armed and a function operation is never called when there is nothing to wait for
	const controller = new AbortController();
	controller.abort(new Error('already'));

	const operation = vi.fn(() => Promise.resolve('never'));

	await expect(withTimeout(operation, 10_000, { signal: controller.signal })).rejects.toThrow('already');
	expect(operation).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);

	// 2. A promise handed in with an aborted signal is still observed: were its rejection left unhandled, Vitest
	//    would report it and fail the run
	await expect(withTimeout(Promise.reject(new Error('late')), 10_000, { signal: controller.signal })).rejects.toThrow(
		'already',
	);
});

test('Rejects with what a function operation throws before returning a promise', async () => {
	// 1. A synchronous throw fails the call right away, with the deadline timer already cleared
	const wait = withTimeout(() => {
		throw new Error('bad start');
	}, 1000);

	await expect(wait).rejects.toThrow('bad start');
	expect(vi.getTimerCount()).toBe(0);
});

test('Resolves with a plain value a function operation answers with, clearing the timer', async () => {
	// 1. The type demands a promise, but a callback that returns a value must not break the settle or leak the timer
	const wait = withTimeout(() => 42 as never, 1000);

	await expect(wait).resolves.toBe(42);
	expect(vi.getTimerCount()).toBe(0);
});

test('Removes its abort listener once the operation settled, so a shared signal keeps no reference', async () => {
	// 1. The listener is there while the wait runs and gone on settlement, so a late abort finds nothing to reject
	//    and a shutdown signal shared by many calls does not accumulate one listener per finished call
	const controller = new AbortController();
	const wait = withTimeout(resolveAfter(100, 'ok'), 1000, { signal: controller.signal });

	expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);

	await vi.advanceTimersByTimeAsync(100);
	await expect(wait).resolves.toBe('ok');

	expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
	controller.abort();
	expect(vi.getTimerCount()).toBe(0);
});

test('Refuses a deadline the timer cannot hold instead of firing it at once', async () => {
	// 1. Negative, NaN and overlong deadlines would all become a 1 ms timer in Node; each is a RangeError, and a
	//    promise handed in is observed so its later rejection is not unhandled
	const rejecting = Promise.reject(new Error('late'));

	await expect(withTimeout(rejecting, -1)).rejects.toThrow(RangeError);
	await expect(withTimeout(new Promise(() => {}), Number.NaN)).rejects.toThrow(RangeError);
	await expect(withTimeout(new Promise(() => {}), MAX_TIMER_DELAY + 1)).rejects.toThrow(RangeError);
	expect(vi.getTimerCount()).toBe(0);

	// 2. A function operation is never started for a deadline that was refused
	const operation = vi.fn(async () => 'value');
	await expect(withTimeout(operation, -1)).rejects.toThrow(RangeError);
	expect(operation).not.toHaveBeenCalled();
});
