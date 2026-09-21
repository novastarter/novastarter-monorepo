/**
 * Wait for a number of milliseconds, optionally giving up early on an abort signal.
 *
 * The promise form of `setTimeout`, so a pause reads as one `await` inside a retry loop or a poll. With a `signal`,
 * aborting rejects the promise with the signal's reason and clears the timer, so a shutdown does not sit out the
 * remaining pause; a signal already aborted rejects at once without arming a timer at all.
 *
 * @param ms - Milliseconds to wait.
 * @param signal - Aborting it ends the wait early.
 * @returns Once `ms` elapsed.
 * @throws The `signal.reason` when the signal aborts before the time is up.
 * @example
 * ```ts
 * await sleep(500);
 *
 * await sleep(60_000, controller.signal); // rejects as soon as `controller.abort()` runs
 * ```
 */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
	return new Promise((resolve, reject) => {
		// 1. A signal aborted before the call: fail right away rather than arming a timer nobody waits for
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}

		// 2. Arm the timer; on fire, the abort listener is dropped so a later abort of a long-lived signal finds
		//    nothing to call
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);

		// 3. On abort, clear the timer and reject with the signal's reason, so the caller sees why the wait ended
		function onAbort(): void {
			clearTimeout(timer);
			reject(signal?.reason);
		}

		signal?.addEventListener('abort', onAbort, { once: true });
	});
};
