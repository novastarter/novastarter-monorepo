/**
 * The wait GitHub asks for when it refuses a request for going too fast, in seconds; `undefined` for any other refusal.
 *
 * GitHub answers a rate limit with a 403 as often as a 429. The primary limit leaves `x-ratelimit-remaining: 0` and
 * names its end in `x-ratelimit-reset`, in epoch seconds; a secondary limit names its wait in `Retry-After`, which
 * wins when both are there, as GitHub's documentation says. A 429 that names neither waits a minute, GitHub's advice
 * for a secondary limit without a header. A 403 without either header is a missing permission, not a limit.
 *
 * @param status - The HTTP status.
 * @param headers - The response headers.
 * @returns The seconds to wait, possibly `0` or fractional; `undefined` when the refusal is not a rate limit.
 * @example
 * ```ts
 * githubRateLimitWait(403, new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' }));
 * ```
 */
export const githubRateLimitWait = (status: number, headers: Headers): number | undefined => {
	// 1. Only a 403 or a 429 can be a rate limit
	if (status !== 403 && status !== 429) return undefined;

	// 2. A secondary limit's own wait comes first; an unreadable value still marks the refusal as a limit
	const retryAfter = headers.get('retry-after');

	if (retryAfter !== null) {
		const seconds = Number(retryAfter);

		return Number.isFinite(seconds) && retryAfter.trim() !== '' ? seconds : SECONDARY_LIMIT_WAIT;
	}

	// 3. The primary limit: the budget is spent, and the reset says when it refills
	if (headers.get('x-ratelimit-remaining') === '0') {
		const reset = Number(headers.get('x-ratelimit-reset'));

		return Number.isFinite(reset) && reset > 0 ? reset - Date.now() / 1000 : SECONDARY_LIMIT_WAIT;
	}

	// 4. A 429 with no word on the wait is still a limit; a bare 403 is a permission GitHub refused
	return status === 429 ? SECONDARY_LIMIT_WAIT : undefined;
};

/**
 * How long to wait on a rate limit that names no wait of its own, in seconds: a minute, as GitHub advises.
 *
 * @defaultValue 60 seconds.
 * @internal
 */
const SECONDARY_LIMIT_WAIT = 60;
