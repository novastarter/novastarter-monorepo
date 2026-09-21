/**
 * Tests of `utils/retry`: attempts, pacing, the retry budget, `shouldRetry` and abort.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_RETRY_OPTIONS, retry } from './retry.js';
import { MAX_TIMER_DELAY, sleep } from './sleep.js';

vi.mock('./sleep.js', { spy: true });

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();

	// 1. Only the `Math.random` spy of the jitter tests is restored: `vi.restoreAllMocks()` would also undo the
	//    module spy on `sleep` every test relies on
	if (vi.isMockFunction(Math.random)) {
		vi.mocked(Math.random).mockRestore();
	}
});

/**
 * Operation that fails a given number of times before succeeding, so each test controls when a retry pays off.
 *
 * @param failures - How many calls throw before the first success.
 * @returns A mock operation resolving to `'ok'` once the failures are spent.
 */
const failing = (failures: number) => {
	let calls = 0;

	return vi.fn(async (): Promise<string> => {
		// 1. Throw a distinct error per call, so a test can tell which attempt's error came out
		if (calls++ < failures) {
			throw new Error(`fail ${calls}`);
		}

		return 'ok';
	});
};

test('Answers with the first result when the operation succeeds at once', async () => {
	// 1. No retry means no pause: `sleep` is never called
	const fn = failing(0);

	await expect(retry(fn)).resolves.toBe('ok');
	expect(fn).toHaveBeenCalledOnce();
	expect(fn).toHaveBeenCalledWith(1);
	expect(sleep).not.toHaveBeenCalled();
});

test('Retries until the operation succeeds, numbering the attempts from one', async () => {
	// 1. Two failures take three calls; the attempt number the operation receives counts each of them
	const fn = failing(2);
	const run = retry(fn, { delay: 10, factor: 1 });

	await vi.runAllTimersAsync();

	await expect(run).resolves.toBe('ok');
	expect(fn).toHaveBeenCalledTimes(3);
	expect(fn).toHaveBeenNthCalledWith(1, 1);
	expect(fn).toHaveBeenNthCalledWith(2, 2);
	expect(fn).toHaveBeenNthCalledWith(3, 3);
});

test('Throws the last error once the retries are spent', async () => {
	// 1. `retries: 2` allows three calls; the error of the third is what comes out, not a wrapper
	const fn = failing(5);
	const run = retry(fn, { retries: 2, delay: 10 });
	const outcome = run.catch((error: Error) => error);

	await vi.runAllTimersAsync();

	await expect(outcome).resolves.toEqual(new Error('fail 3'));
	expect(fn).toHaveBeenCalledTimes(3);
});

test('Runs the operation once with zero retries', async () => {
	const fn = failing(1);

	await expect(retry(fn, { retries: 0 })).rejects.toThrow('fail 1');
	expect(fn).toHaveBeenCalledOnce();
	expect(sleep).not.toHaveBeenCalled();
});

test('Applies the default budget and pacing when no option is given', async () => {
	// 1. Three retries after the first call, pauses of 100, 200 and 400 ms
	const fn = failing(10);
	const run = retry(fn);
	const outcome = run.catch((error: Error) => error);

	await vi.runAllTimersAsync();

	await expect(outcome).resolves.toEqual(new Error(`fail ${DEFAULT_RETRY_OPTIONS.retries + 1}`));
	expect(fn).toHaveBeenCalledTimes(4);
	expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual([100, 200, 400]);
});

test('Grows a numeric delay by the factor and caps it at maxDelay', async () => {
	// 1. Base 100 doubling: 100, 200, 400, then 800 capped to 500
	const fn = failing(4);
	const run = retry(fn, { retries: 4, delay: 100, factor: 2, maxDelay: 500 });

	await vi.runAllTimersAsync();
	await run;

	expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual([100, 200, 400, 500]);
});

test('Keeps the delay constant with a factor of one', async () => {
	const fn = failing(3);
	const run = retry(fn, { delay: 250, factor: 1 });

	await vi.runAllTimersAsync();
	await run;

	expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual([250, 250, 250]);
});

test('Lets a delay function decide each pause from the retry number', async () => {
	// 1. The function sees 1, 2, 3 for the three retries; the factor is ignored
	const delay = vi.fn((attempt: number) => 500 * attempt);
	const fn = failing(3);
	const run = retry(fn, { delay, factor: 10 });

	await vi.runAllTimersAsync();
	await run;

	expect(delay.mock.calls).toEqual([[1], [2], [3]]);
	expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 1500]);
});

test('Stops at once when shouldRetry answers false', async () => {
	// 1. The rejected error is thrown as it came, without a pause, and `shouldRetry` sees the attempt number
	const shouldRetry = vi.fn(() => false);
	const fn = failing(3);

	await expect(retry(fn, { shouldRetry })).rejects.toThrow('fail 1');
	expect(fn).toHaveBeenCalledOnce();
	expect(shouldRetry).toHaveBeenCalledWith(new Error('fail 1'), 1);
	expect(sleep).not.toHaveBeenCalled();
});

test('Hands the signal to every pause and gives up when it aborts', async () => {
	// 1. The pause rejects with the abort reason, which ends the retry with that reason and no further attempt
	const controller = new AbortController();
	const fn = failing(3);
	const run = retry(fn, { delay: 1000, signal: controller.signal });
	const outcome = run.catch((error: Error) => error);

	await vi.advanceTimersByTimeAsync(10);
	controller.abort(new Error('shutting down'));

	await expect(outcome).resolves.toEqual(new Error('shutting down'));
	expect(sleep).toHaveBeenCalledWith(1000, controller.signal);
	expect(fn).toHaveBeenCalledOnce();
});

test('Rejects at once with a signal already aborted, without running the operation', async () => {
	// 1. No attempt and no pause: the reason comes out as it is, the same as `sleep` and `withTimeout` answer
	const controller = new AbortController();
	const fn = failing(0);

	controller.abort(new Error('already down'));

	await expect(retry(fn, { signal: controller.signal })).rejects.toThrow('already down');
	expect(fn).not.toHaveBeenCalled();
	expect(sleep).not.toHaveBeenCalled();
});

test('Refuses a retries budget that is not a whole number of zero or more', async () => {
	// 1. `attempt > NaN` never holds, so a NaN budget would retry forever; a fraction or a negative is a mistake too
	const fn = failing(0);

	await expect(retry(fn, { retries: Number.NaN })).rejects.toThrow(RangeError);
	await expect(retry(fn, { retries: 1.5 })).rejects.toThrow(RangeError);
	await expect(retry(fn, { retries: -1 })).rejects.toThrow(RangeError);
	expect(fn).not.toHaveBeenCalled();
	expect(sleep).not.toHaveBeenCalled();
});

test('Never asks for a pause longer than a timer can hold', async () => {
	// 1. An uncapped `maxDelay` used to let an overgrown pause reach `sleep`, which Node would arm as 1 ms: the base
	//    pause here is already past the limit, and the second one ten times so
	const fn = failing(2);
	const run = retry(fn, { delay: MAX_TIMER_DELAY + 1, factor: 10, maxDelay: Number.POSITIVE_INFINITY });

	await vi.runAllTimersAsync();
	await run;

	expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual([MAX_TIMER_DELAY, MAX_TIMER_DELAY]);
});

test('Refuses a jitter outside 0 to 1 before running the operation', async () => {
	// 1. A jitter above one could turn a pause negative; the misconfiguration is a RangeError, not a busy loop
	const fn = failing(0);

	await expect(retry(fn, { jitter: 1.5 })).rejects.toThrow(RangeError);
	await expect(retry(fn, { jitter: -0.1 })).rejects.toThrow(RangeError);
	await expect(retry(fn, { jitter: Number.NaN })).rejects.toThrow(RangeError);
	expect(fn).not.toHaveBeenCalled();
	expect(sleep).not.toHaveBeenCalled();
});

test('Spreads each pause by the jitter, drawing the factor from Math.random', async () => {
	// 1. `Math.random` of 0, 0.5 and 1 give the factors 0.75, 1 and 1.25 with a jitter of 0.25: the low end, the
	//    exact pause and the high end of the spread
	vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(1);

	const fn = failing(3);
	const run = retry(fn, { delay: 100, factor: 1, jitter: 0.25 });

	await vi.runAllTimersAsync();
	await run;

	expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual([75, 100, 125]);
});

test('Caps a jittered pause at maxDelay', async () => {
	// 1. The high end of the spread, 125, is above the cap of 110; the cap wins
	vi.spyOn(Math, 'random').mockReturnValue(1);

	const fn = failing(1);
	const run = retry(fn, { delay: 100, jitter: 0.25, maxDelay: 110 });

	await vi.runAllTimersAsync();
	await run;

	expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual([110]);
});

test('Leaves the pause exact without jitter', async () => {
	// 1. The default jitter of zero never consults `Math.random`
	const random = vi.spyOn(Math, 'random');
	const fn = failing(2);
	const run = retry(fn, { delay: 100, factor: 2 });

	await vi.runAllTimersAsync();
	await run;

	expect(random).not.toHaveBeenCalled();
	expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
});

test('Reports each pause to onRetry with the error, the attempt and the wait', async () => {
	// 1. Two failures mean two pauses; the callback runs before each with the pause `sleep` then receives
	const onRetry = vi.fn();
	const fn = failing(2);
	const run = retry(fn, { delay: 100, factor: 2, onRetry });

	await vi.runAllTimersAsync();
	await run;

	expect(onRetry.mock.calls).toEqual([
		[new Error('fail 1'), 1, 100],
		[new Error('fail 2'), 2, 200],
	]);

	expect(onRetry.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sleep).mock.invocationCallOrder[0]!);
});

test('Does not call onRetry on success, on a refused error or on the last failure', async () => {
	// 1. A first-try success has no pause to report
	const onRetry = vi.fn();

	await retry(failing(0), { onRetry });
	expect(onRetry).not.toHaveBeenCalled();

	// 2. An error `shouldRetry` refuses is thrown, not paused on
	await expect(retry(failing(1), { onRetry, shouldRetry: () => false })).rejects.toThrow('fail 1');
	expect(onRetry).not.toHaveBeenCalled();

	// 3. With one retry, only the first failure is followed by a pause; the second is thrown
	const run = retry(failing(5), { retries: 1, delay: 10, onRetry });
	const outcome = run.catch((error: Error) => error);

	await vi.runAllTimersAsync();

	await expect(outcome).resolves.toEqual(new Error('fail 2'));
	expect(onRetry).toHaveBeenCalledOnce();
	expect(onRetry).toHaveBeenCalledWith(new Error('fail 1'), 1, 10);
});

test('Ends the loop with what onRetry throws, without another attempt', async () => {
	const operation = failing(3);

	const onRetry = vi.fn(() => {
		throw new Error('log sink down');
	});

	// 1. The callback runs before the pause; its error takes over, so no pause is armed and no attempt follows
	await expect(retry(operation, { onRetry })).rejects.toThrow('log sink down');
	expect(operation).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
});
