/**
 * What {@link withTimeout} rejects with when the operation outlives its deadline and no `error` factory is given.
 *
 * Named `TimeoutError` like the `DOMException` of `AbortSignal.timeout()`, so a handler that checks `error.name`
 * treats both the same way.
 */
export class TimeoutError extends Error {
	/**
	 * @param ms - The deadline that passed, in milliseconds.
	 */
	constructor(ms: number) {
		super(`Timed out after ${ms} ms`);
		this.name = 'TimeoutError';
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
 * @param ms - Milliseconds allowed.
 * @param options - An outer abort signal and what to throw on timeout; see {@link WithTimeoutOptions}.
 * @returns What the operation resolved to, when it did so in time.
 * @throws The `options.error(ms)` result — a {@link TimeoutError} by default — when the deadline passes first, the
 * `options.signal.reason` when that signal aborts first, or whatever the operation rejected with.
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
	// 1. A signal aborted before the call: fail right away rather than starting work nobody waits for. A promise
	//    handed in is already running; its outcome is observed so a late rejection is not reported as unhandled
	if (signal?.aborted) {
		if (typeof operation !== 'function') {
			operation.catch(() => {});
		}

		return Promise.reject(signal.reason);
	}

	// 2. One controller serves the function form: its signal carries the timeout or the outer abort to the operation
	const controller = new AbortController();

	return new Promise<T>((resolve, reject) => {
		// 3. The deadline: reject the caller and abort the operation's signal with the same error, so a function
		//    operation that watches its signal sees why it was stopped. A factory that throws rejects with what it
		//    threw: inside a timer callback the exception would otherwise be uncaught and take the process down
		const timer = setTimeout(() => {
			let reason: unknown;

			try {
				reason = error(ms);
			} catch (thrown) {
				reason = thrown;
			}

			cleanup();
			controller.abort(reason);
			reject(reason);
		}, ms);

		// 4. An outer abort ends the wait with the signal's reason and passes it on to the operation's signal
		function onAbort(): void {
			cleanup();
			controller.abort(signal?.reason);
			reject(signal?.reason);
		}

		// 5. Whichever way the wait ends, the timer and the listener go, so nothing fires on a settled promise and a
		//    long-lived signal keeps no reference to this call
		function cleanup(): void {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
		}

		signal?.addEventListener('abort', onAbort, { once: true });

		// 6. Start the work — a function gets the controller's signal; one that throws before returning a promise
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

		// 7. Settle with the operation's outcome when it comes in time; a settle after the deadline or the abort is
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
