import ms from 'ms';
import { ErrorCode } from '../codes.js';
import { createError, type NovastarterErrorConstructor } from '../create-error.js';

/**
 * Details of a rate-limit hit.
 */
export interface HitRateLimitErrorExtensions {
	/** Number of points the limiter allows per window. */
	limit: number;
	/** Moment the caller may try again. */
	reset: Date;
}

/**
 * Build the message of a {@link HitRateLimitError} from its extensions.
 *
 * @param extensions - Limit and reset time of the hit.
 * @returns Message telling the caller how long to wait, in a human-readable duration.
 */
export const hitRateLimitMessage = (extensions: HitRateLimitErrorExtensions): string => {
	// 1. Express the wait relative to now, since that is what the caller needs to know
	const msBeforeNext = extensions.reset.getTime() - Date.now();

	// 2. Clamp at zero: a reset in the past means "retry now", not a negative duration, and an invalid Date yields
	//    `NaN` — which `ms` would throw on — so it lands on zero too
	const retryAfter = Number.isNaN(msBeforeNext) ? 0 : Math.max(0, msBeforeNext);

	return `Too many requests, retry after ${ms(retryAfter)}.`;
};

/**
 * Error thrown when a key has used up its points in a rate limiter.
 *
 * Answers with HTTP 429 and carries the limit plus the reset time, so a transport layer can set `Retry-After`.
 *
 * @example
 * ```ts
 * throw new HitRateLimitError({
 * 	limit: 10,
 * 	reset: new Date(Date.now() + 5_000),
 * });
 * ```
 */
export const HitRateLimitError: NovastarterErrorConstructor<HitRateLimitErrorExtensions> =
	createError<HitRateLimitErrorExtensions>(ErrorCode.RequestsExceeded, hitRateLimitMessage, 429);
