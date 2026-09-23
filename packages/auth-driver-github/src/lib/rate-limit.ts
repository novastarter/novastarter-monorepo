/**
 * The wait GitHub asks for when it refuses a request for going too fast, in seconds; `undefined` for any other refusal.
 *
 * GitHub answers a rate limit with a 403 as often as a 429. The primary limit leaves `x-ratelimit-remaining: 0` and
 * names its end in `x-ratelimit-reset`, in epoch seconds; a secondary limit names its wait in `Retry-After`, which
 * wins when both are there, as GitHub's documentation says. A 429 that names neither waits a minute, GitHub's advice
 * for a secondary limit without a header. A 403 whose message speaks of a "secondary rate limit" is one too, and
 * waits a minute unless a header says otherwise. Any other 403 without either header is a missing permission.
 *
 * @param status - The HTTP status.
 * @param headers - The response headers.
 * @param body - The parsed response body, where GitHub's `message` names a secondary limit.
 * @returns The seconds to wait, possibly `0` or fractional; `undefined` when the refusal is not a rate limit.
 * @example
 * ```ts
 * githubRateLimitWait(403, new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' }));
 * ```
 */
export const githubRateLimitWait = (status: number, headers: Headers, body?: unknown): number | undefined => {
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

		// 1. A reset already past — a clock ahead of GitHub's — means no wait rather than a negative one
		return Number.isFinite(reset) && reset > 0 ? Math.max(0, reset - Date.now() / 1000) : SECONDARY_LIMIT_WAIT;
	}

	// 4. A 429 with no word on the wait, or a 403 whose message names a secondary limit, is still a limit; any other
	//    bare 403 is a permission GitHub refused
	return status === 429 || isSecondaryLimitMessage(body) ? SECONDARY_LIMIT_WAIT : undefined;
};

/**
 * Whether GitHub's error body says a secondary rate limit was hit — the only sign of one some 403s carry.
 *
 * @param body - The parsed response body.
 * @returns `true` when its `message` mentions a secondary rate limit.
 * @internal
 */
const isSecondaryLimitMessage = (body: unknown): boolean => {
	// 1. GitHub's errors are `{ message }`; anything else says nothing about a limit
	const message = (body as { message?: unknown } | null | undefined)?.message;

	return typeof message === 'string' && /secondary rate limit/i.test(message);
};

/**
 * How long to wait on a rate limit that names no wait of its own, in seconds: a minute, as GitHub advises.
 *
 * @defaultValue 60 seconds.
 * @internal
 */
const SECONDARY_LIMIT_WAIT = 60;
