/**
 * Tests of `githubRateLimitWait`: which refusals of GitHub are rate limits, and the wait each one names.
 */
import { describe, expect, test } from 'vitest';
import { githubRateLimitWait } from './rate-limit.js';

describe('githubRateLimitWait', () => {
	test('Reads the primary limit of a 403 from x-ratelimit-reset', () => {
		// 1. The reset is epoch seconds; the wait is the time left until it
		const reset = Math.floor(Date.now() / 1000) + 120;
		const headers = new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) });

		expect(githubRateLimitWait(403, headers)).toBeGreaterThan(118);
		expect(githubRateLimitWait(403, headers)).toBeLessThanOrEqual(120);
	});

	test('Prefers Retry-After of a secondary limit, on a 403 or a 429', () => {
		// 1. `Retry-After` wins over the reset when both are there
		const headers = new Headers({ 'retry-after': '30', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' });

		expect(githubRateLimitWait(403, headers)).toBe(30);
		expect(githubRateLimitWait(429, new Headers({ 'retry-after': '5' }))).toBe(5);
	});

	test('Waits a minute on a 429 naming no wait, and is no limit on a bare 403 or another status', () => {
		// 1. A 403 without the limit headers is a permission refusal; the budget left is not zero there
		expect(githubRateLimitWait(429, new Headers())).toBe(60);
		expect(githubRateLimitWait(403, new Headers())).toBeUndefined();
		expect(githubRateLimitWait(403, new Headers({ 'x-ratelimit-remaining': '12' }))).toBeUndefined();
		expect(githubRateLimitWait(404, new Headers({ 'retry-after': '5' }))).toBeUndefined();
	});

	test('Reads a 403 whose message names a secondary rate limit as a limit of a minute', () => {
		// 1. Some secondary limits carry no header at all, only GitHub's message; a header still names the wait
		const body = { message: 'You have exceeded a secondary rate limit. Please wait a few minutes.' };

		expect(githubRateLimitWait(403, new Headers(), body)).toBe(60);
		expect(githubRateLimitWait(403, new Headers({ 'retry-after': '12' }), body)).toBe(12);
		expect(githubRateLimitWait(403, new Headers(), { message: 'Resource not accessible' })).toBeUndefined();
	});

	test('Waits no time for a reset already past', () => {
		// 1. A clock ahead of GitHub's never yields a negative wait
		const headers = new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1000' });

		expect(githubRateLimitWait(403, headers)).toBe(0);
	});
});
