import { HitRateLimitError } from '@novastarter/errors';
import type { IRateLimiterRes, RateLimiterAbstract } from 'rate-limiter-flexible';

/**
 * Consume one point and turn the library's rejection into a `HitRateLimitError`.
 *
 * `rate-limiter-flexible` rejects with a plain result object (not an `Error`) when the budget is exhausted, and with
 * a real `Error` when something else went wrong, for example a lost Redis connection. Only the former is a rate-limit
 * hit; the latter is passed through untouched.
 *
 * @param limiter - Memory or Redis limiter instance.
 * @param key - Key to consume a point for.
 * @param availablePoints - Configured points per window, reported in the error.
 * @returns Resolves when the point was available.
 * @throws `HitRateLimitError` when the key has no points left; any other error the limiter raised.
 */
export const consume = async (limiter: RateLimiterAbstract, key: string, availablePoints: number): Promise<void> => {
	// 1. Let the library do the bookkeeping; it rejects when the budget is spent
	try {
		await limiter.consume(key);
	} catch (err) {
		// 2. Real errors (connection problems and the like) are not rate-limit hits; rethrow them as they are
		if (err instanceof Error) {
			throw err;
		}

		// 3. The rejection value is the limiter result; `msBeforeNext` is always set on it despite the optional
		//    type, so the non-null assertion is safe
		const { msBeforeNext } = err as IRateLimiterRes;

		throw new HitRateLimitError({
			limit: availablePoints,
			reset: new Date(Date.now() + msBeforeNext!),
		});
	}
};
