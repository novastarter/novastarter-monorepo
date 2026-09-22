/**
 * The longest wait a timer can hold, in milliseconds.
 *
 * `setTimeout` takes a signed 32-bit delay; Node replaces a longer one with 1 ms and only warns, so a wait past this
 * would end at once instead of late. {@link sleep} refuses it, and `retry` caps its pauses by it.
 *
 * @defaultValue 2^31 - 1, about 24.8 days
 */
export const MAX_TIMER_DELAY = 2_147_483_647;

/**
 * Wait for a number of milliseconds, optionally giving up early on an abort signal.
 *
 * The promise form of `setTimeout`, so a pause reads as one `await` inside a retry loop or a poll. With a `signal`,
 * aborting rejects the promise with the signal's reason and clears the timer, so a shutdown does not sit out the
 * remaining pause; a signal already aborted rejects at once without arming a timer at all.
 *
 * @param ms - Milliseconds to wait, from `0` to {@link MAX_TIMER_DELAY}.
 * @param signal - Aborting it ends the wait early.
 * @returns Once `ms` elapsed.
 * @throws `RangeError` when `ms` is negative, `NaN` or above {@link MAX_TIMER_DELAY}, since the timer would fire at
 * once and the wait be silently skipped; the `signal.reason` when the signal aborts before the time is up.
 * @example
 * ```ts
 * await sleep(500);
 *
 * await sleep(60_000, controller.signal); // rejects as soon as `controller.abort()` runs
 * ```
 */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
	return new Promise((resolve, reject) => {
		// 1. A wait the timer cannot hold is refused rather than turned into no wait: Node arms 1 ms for a negative,
		//    `NaN` or overlong delay, which a caller pacing a retry or a poll would never notice
		if (!(ms >= 0 && ms <= MAX_TIMER_DELAY)) {
			reject(new RangeError(`sleep: "ms" must be between 0 and ${MAX_TIMER_DELAY}, got ${ms}`));
			return;
		}

		// 2. A signal aborted before the call: fail right away rather than arming a timer nobody waits for
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}

		// 3. Arm the timer; on fire, the abort listener is dropped so a later abort of a long-lived signal finds
		//    nothing to call
		const timer = setTimeout(() => {
			// 1. The wait is over: the listener goes first, so an abort arriving now finds nothing to reject
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);

		// 4. On abort, clear the timer and reject with the signal's reason, so the caller sees why the wait ended
		function onAbort(): void {
			// 1. The timer goes first, so it cannot resolve a promise this rejection is about to settle
			clearTimeout(timer);
			reject(signal?.reason);
		}

		signal?.addEventListener('abort', onAbort, { once: true });
	});
};
