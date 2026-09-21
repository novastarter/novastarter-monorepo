import { MAX_TIMER_DELAY, sleep } from './sleep.js';

/**
 * How {@link retry} paces and bounds its attempts.
 */
export interface RetryOptions {
	/**
	 * Attempts allowed after the first one, a whole number; `0` runs the operation once. Anything else — a negative
	 * number, a fraction, `NaN` — is refused, since `NaN` would never count as spent and retry forever.
	 *
	 * @defaultValue 3
	 */
	retries?: number;

	/**
	 * Pause before a retry, in milliseconds: a base that {@link RetryOptions.factor} grows, or a function of the
	 * number of the attempt that failed (`1` for the first) that decides each pause itself.
	 *
	 * @defaultValue 100
	 */
	delay?: number | ((attempt: number) => number);

	/**
	 * Multiplier applied to a numeric {@link RetryOptions.delay} on each further retry; `1` keeps the pause constant.
	 * Ignored when `delay` is a function.
	 *
	 * @defaultValue 2
	 */
	factor?: number;

	/**
	 * Ceiling for a pause, in milliseconds, so exponential growth never waits for minutes.
	 *
	 * Finite by default, and never above the 2^31 - 1 ms a timer can hold: Node silently turns a longer `setTimeout`
	 * into a 1 ms one, so an uncapped pause that grew past it would become no pause at all.
	 *
	 * @defaultValue 30 000 (half a minute)
	 */
	maxDelay?: number;

	/**
	 * Random spread of each pause, as a fraction of it between `0` and `1`: the pause is multiplied by a factor drawn
	 * evenly between `1 - jitter` and `1 + jitter`, so many workers that failed together do not retry together. `0`
	 * keeps every pause exact; anything outside the range is refused, since above `1` a pause could come out
	 * negative. Applied to a function `delay` too, before the {@link RetryOptions.maxDelay} cap.
	 *
	 * @defaultValue 0
	 */
	jitter?: number;

	/**
	 * Called before each pause, with the error of the attempt that failed, its number and the pause in milliseconds;
	 * for a log line. Not called on success, for an error {@link RetryOptions.shouldRetry} refuses or for the last
	 * failure, which is thrown instead. One that throws ends the loop with what it threw: the attempt's error is not
	 * retried, and not thrown either.
	 *
	 * @param error - What the attempt threw.
	 * @param attempt - Number of the attempt that failed, `1` for the first.
	 * @param delay - Milliseconds until the next attempt.
	 */
	onRetry?: (error: unknown, attempt: number, delay: number) => void;

	/**
	 * Whether a failed attempt is worth another: answer `false` for an error that will not go away, such as a 4xx.
	 *
	 * @param error - What the attempt threw.
	 * @param attempt - Number of the attempt that failed, `1` for the first.
	 * @returns `true` to retry, `false` to throw `error` right away.
	 * @defaultValue Every error is retried.
	 */
	shouldRetry?: (error: unknown, attempt: number) => boolean;

	/**
	 * Aborting it ends a pause early and throws the signal's reason; a running attempt is not interrupted, and a
	 * signal already aborted before the call means no attempt at all. The error of the attempt that failed before
	 * the pause is not part of the reason; it went to {@link RetryOptions.onRetry} just before.
	 */
	signal?: AbortSignal;
}

/**
 * Pacing applied when the caller passes no option.
 *
 * @defaultValue 3 retries, 100 ms base pause doubling each time, 30 s ceiling, no jitter, every error retried.
 */
export const DEFAULT_RETRY_OPTIONS: Readonly<Required<Omit<RetryOptions, 'signal' | 'onRetry'>>> = Object.freeze({
	retries: 3,
	delay: 100,
	factor: 2,
	maxDelay: 30_000,
	jitter: 0,
	shouldRetry: () => true,
});

/**
 * Run an operation again until it succeeds, pausing between attempts, and throw its last error when the budget is
 * spent.
 *
 * For calls that fail transiently — a listing that lags behind a write, a connection reset — where a second attempt
 * a moment later is the whole fix. The operation is called at least once; a failure that
 * {@link RetryOptions.shouldRetry} rejects, or the failure of the last allowed attempt, is thrown as it came, so the
 * caller handles the real error, not a wrapper. Each pause is reported to {@link RetryOptions.onRetry} first, so a
 * caller can log what failed and how long the wait is.
 *
 * @typeParam T - What the operation resolves to.
 * @param fn - Operation to run; receives the attempt number, `1` for the first call.
 * @param options - Pacing and bounds; see {@link DEFAULT_RETRY_OPTIONS} for what applies when omitted.
 * @returns The result of the first attempt that succeeds.
 * @throws The error of the last attempt, or the abort reason when `options.signal` aborts during a pause or was
 * aborted before the call; what `options.onRetry` threw, when it did; a `RangeError` before any attempt when
 * `options.retries` is not a whole number of zero or more or `options.jitter` is outside `0` to `1`.
 * @example
 * ```ts
 * const parts = await retry(() => listParts(uploadId), {
 * 	retries: 3,
 * 	delay: (attempt) => 500 * attempt,
 * });
 *
 * await retry(() => fetchJson(url), {
 * 	shouldRetry: (error) => error instanceof HttpError && error.status >= 500,
 * });
 * ```
 */
export const retry = async <T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> => {
	// 1. Each option falls back to its default; `signal` and `onRetry` have none and are read as given
	const {
		retries = DEFAULT_RETRY_OPTIONS.retries,
		delay = DEFAULT_RETRY_OPTIONS.delay,
		factor = DEFAULT_RETRY_OPTIONS.factor,
		maxDelay = DEFAULT_RETRY_OPTIONS.maxDelay,
		jitter = DEFAULT_RETRY_OPTIONS.jitter,
		shouldRetry = DEFAULT_RETRY_OPTIONS.shouldRetry,
		onRetry,
		signal,
	} = options;

	// 2. A budget that is not a whole number of zero or more is refused before any attempt: `attempt > NaN` is never
	//    true, so a `NaN` budget would retry forever, and a fraction or a negative number is a mistake as well
	if (!Number.isInteger(retries) || retries < 0) {
		throw new RangeError(`retry: "retries" must be a whole number of zero or more, got ${retries}`);
	}

	// 3. A jitter above one would let a pause come out negative, which `setTimeout` silently rounds up to zero; a
	//    misconfiguration is refused before any attempt rather than turned into a busy retry loop
	if (jitter < 0 || jitter > 1) {
		throw new RangeError(`retry: "jitter" must be between 0 and 1, got ${jitter}`);
	}

	// 4. A signal aborted before the call: fail right away rather than running an attempt nobody waits for
	if (signal?.aborted) {
		throw signal.reason;
	}

	// 5. Attempts are numbered from one, so the first retry is attempt two and the last allowed is `retries + 1`
	for (let attempt = 1; ; attempt++) {
		try {
			return await fn(attempt);
		} catch (error) {
			// 6. Out of budget, or an error not worth retrying: hand it over untouched
			if (attempt > retries || !shouldRetry(error, attempt)) {
				throw error;
			}

			// 7. The base pause: a function decides itself from the number of the failed attempt, a number grows by
			//    `factor` per retry
			const base = typeof delay === 'function' ? delay(attempt) : delay * factor ** (attempt - 1);

			// 8. Spread it by `jitter` — a factor drawn evenly between `1 - jitter` and `1 + jitter`, never below zero
			//    since `jitter` is at most one, so the mean pause stays what the caller asked for — and cap the result
			//    by `maxDelay` and by what a timer can hold, so the cap bounds the spread as well as the growth and an
			//    overgrown pause never collapses into Node's 1 ms fallback
			const spread = jitter === 0 ? base : base * (1 + (Math.random() * 2 - 1) * jitter);
			const pause = Math.min(spread, maxDelay, MAX_TIMER_DELAY);

			// 9. Report, then wait: the callback sees the pause that is about to happen
			onRetry?.(error, attempt, pause);

			await sleep(pause, signal);
		}
	}
};
