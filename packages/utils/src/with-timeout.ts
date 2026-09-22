import { MAX_TIMER_DELAY } from './sleep.js';

/**
 * What {@link withTimeout} rejects with when the operation outlives its deadline and no `error` factory is given.
 *
 * Named `TimeoutError` like the `DOMException` of `AbortSignal.timeout()`, so a handler that checks `error.name`
 * treats both the same way.
 */
export class TimeoutError extends Error {
	/**
	 * The deadline that passed, in milliseconds — as a field, so a handler reads it rather than parsing the message.
	 */
	readonly ms: number;

	/**
	 * Create the error for a deadline that passed.
	 *
	 * @param ms - The deadline that passed, in milliseconds.
	 */
	constructor(ms: number) {
		super(`Timed out after ${ms} ms`);
		this.name = 'TimeoutError';
		this.ms = ms;
	}
}

/**
 * How {@link withTimeout} gives up early and what it throws.
 */
export interface WithTimeoutOptions {
	/**
	 * Aborting it ends the wait at once with the signal's reason — a shutdown that should not sit out the deadline.
	 * A function operation sees the abort on the signal it received.
	 */
	signal?: AbortSignal;

	/**
	 * What to reject with once the deadline passes; a factory, so each timeout gets its own error and stack.
	 *
	 * @param ms - The deadline, in milliseconds.
	 * @returns The error thrown to the caller and, for a function operation, the abort reason of its signal.
	 * @defaultValue `() => new TimeoutError(ms)`
	 */
	error?: (ms: number) => Error;
}

/**
 * Wait for an operation, giving up with an error once a deadline passes.
 *
 * Two forms. A promise is raced against the clock: on timeout the caller gets the error, but the promise itself runs
 * on — JavaScript cannot cancel it — so this form fits work that is retried or marked failed by its own rules, such
 * as a queue job. A function receives an `AbortSignal` that is aborted with the timeout error when the deadline
 * passes, and with the outer signal's reason when that one aborts, so a `fetch` or an SDK call that takes a signal
 * really stops. Either way the timer is cleared as soon as the operation settles, so a finished call leaves nothing
 * behind.
 *
 * @typeParam T - What the operation resolves to.
 * @param operation - The promise to wait for, or a function that starts the work with a signal to watch.
 * @param ms - Milliseconds allowed, from `0` to {@link MAX_TIMER_DELAY}.
 * @param options - An outer abort signal and what to throw on timeout; see {@link WithTimeoutOptions}.
 * @returns What the operation resolved to, when it did so in time.
 * @throws `RangeError` when `ms` is negative, `NaN` or above {@link MAX_TIMER_DELAY} — a timer cannot hold it and
 * Node would fire after 1 ms, failing every operation at once; the `options.error(ms)` result — a
 * {@link TimeoutError} by default — when the deadline passes first, the `options.signal.reason` when that signal
 * aborts first, or whatever the operation rejected with.
 * @example
 * ```ts
 * await withTimeout(processor(job.data), 30_000, { error: () => new JobTimeoutError(name, 30_000) });
 *
 * const response = await withTimeout((signal) => fetch(url, { signal }), 5_000);
 * ```
 */
export const withTimeout = <T>(
	operation: Promise<T> | ((signal: AbortSignal) => Promise<T>),
	ms: number,
	{ signal, error = (limit) => new TimeoutError(limit) }: WithTimeoutOptions = {},
): Promise<T> => {
	// 1. A deadline the timer cannot hold is refused rather than turned into a 1 ms one: Node arms 1 ms for a
	//    negative, `NaN` or overlong delay, which would fail every operation at once instead of never. A promise
	//    handed in is already running; its outcome is observed so a late rejection is not reported as unhandled
	if (!(ms >= 0 && ms <= MAX_TIMER_DELAY)) {
		if (typeof operation !== 'function') {
			operation.catch(() => {});
		}

		return Promise.reject(new RangeError(`withTimeout: "ms" must be between 0 and ${MAX_TIMER_DELAY}, got ${ms}`));
	}

	// 2. A signal aborted before the call: fail right away rather than starting work nobody waits for; the promise
	//    form is observed for the same reason as above
	if (signal?.aborted) {
		if (typeof operation !== 'function') {
			operation.catch(() => {});
		}

		return Promise.reject(signal.reason);
	}

	// 3. One controller serves the function form: its signal carries the timeout or the outer abort to the operation
	const controller = new AbortController();

	// 4. The race itself lives in the executor, whose steps are numbered on their own
	return new Promise<T>((resolve, reject) => {
		// 1. The deadline: reject the caller and abort the operation's signal with the same error, so a function
		//    operation that watches its signal sees why it was stopped. A factory that throws rejects with what it
		//    threw: inside a timer callback the exception would otherwise be uncaught and take the process down
		const timer = setTimeout(() => {
			// 1. The error comes from the factory, or is what the factory threw
			let reason: unknown;

			try {
				reason = error(ms);
			} catch (thrown) {
				reason = thrown;
			}

			// 2. Nothing else may fire now; the operation's signal and the caller get the same reason
			cleanup();
			controller.abort(reason);
			reject(reason);
		}, ms);

		// 2. An outer abort ends the wait with the signal's reason and passes it on to the operation's signal
		function onAbort(): void {
			// 1. Nothing else may fire now; the operation's signal and the caller get the outer signal's reason
			cleanup();
			controller.abort(signal?.reason);
			reject(signal?.reason);
		}

		// 3. Whichever way the wait ends, the timer and the listener go, so nothing fires on a settled promise and a
		//    long-lived signal keeps no reference to this call
		function cleanup(): void {
			// 1. Both are safe to repeat: a cleared timer and a removed listener are no-ops the second time
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
		}

		signal?.addEventListener('abort', onAbort, { once: true });

		// 4. Start the work — a function gets the controller's signal; one that throws before returning a promise
		//    fails the call at once, with the timer already gone. `Promise.resolve` covers a function that answers with
		//    a plain value despite its type, so the settle below always has a `then` and the timer never leaks
		let pending: Promise<T>;

		try {
			pending = Promise.resolve(typeof operation === 'function' ? operation(controller.signal) : operation);
		} catch (cause) {
			cleanup();
			reject(cause);
			return;
		}

		// 5. Settle with the operation's outcome when it comes in time; a settle after the deadline or the abort is
		//    a no-op on an already rejected promise
		pending.then(
			(value) => {
				cleanup();
				resolve(value);
			},
			(cause: unknown) => {
				cleanup();
				reject(cause);
			},
		);
	});
};
