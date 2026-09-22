/**
 * Tests of `memory/limiter/utils/consume`.
 */
import { HitRateLimitError } from '@novastarter/errors';
import { type IRateLimiterRes, RateLimiterMemory } from 'rate-limiter-flexible';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { consume } from './consume.js';

vi.mock('rate-limiter-flexible');

let limiter: RateLimiterMemory;
let key: string;
let points: number;

beforeEach(() => {
	// 1. The library is automocked: the tests drive its `consume` by hand and look at what the wrapper makes of it
	key = 'limiter-test-key';
	points = 5;
	limiter = new RateLimiterMemory({ points, duration: 15 });

	// 2. Fake timers, since the `reset` date is computed from `Date.now()` and has to be asserted exactly
	vi.useFakeTimers();
});

afterEach(() => {
	vi.clearAllMocks();
	vi.useRealTimers();
});

test('Consumes point from rate-limiter', async () => {
	// 1. The key goes to the library as it is; one point per call is the library's default
	await consume(limiter, key, points);

	expect(limiter.consume).toHaveBeenCalledWith(key);
});

test('Rejects error as-is if error instance is given', async () => {
	// 1. A real `Error` — a lost connection — is not a rate-limit hit and must reach the caller untouched
	const mockError = new Error('test');
	vi.mocked(limiter.consume).mockRejectedValue(mockError);

	await expect(consume(limiter, key, points)).rejects.toBe(mockError);
});

test('Rejects HitRateLimitError', async () => {
	// 1. Freeze the clock, so the expected `reset` can be computed the same way the wrapper does
	const systemTime = new Date('2023-12-04T00:00:00.000Z');
	vi.setSystemTime(systemTime);

	// 2. The library rejects with a plain result object, not an `Error`, when the budget is spent
	const mockMsBeforeNext = 1500;
	const mockRes = { msBeforeNext: mockMsBeforeNext } as IRateLimiterRes;
	vi.mocked(limiter.consume).mockRejectedValue(mockRes);

	let res: any;

	try {
		await consume(limiter, key, points);
	} catch (err) {
		res = err;
	}

	// 3. The wrapper turns it into the error the transport layer knows, carrying the limit and the reset moment
	expect(res).toBeInstanceOf(HitRateLimitError);

	expect(res.extensions).toEqual({
		limit: points,
		reset: new Date(systemTime.getTime() + mockMsBeforeNext),
	});
});

test('Answers a key without expiry with a reset of now, not in the past', async () => {
	// 1. The library reports `-1` for a key that never expires; added to the clock as it is, that would be a reset one
	//    millisecond ago and a message saying "retry after -1ms"
	const systemTime = new Date('2023-12-04T00:00:00.000Z');
	vi.setSystemTime(systemTime);

	vi.mocked(limiter.consume).mockRejectedValue({ msBeforeNext: -1 } as IRateLimiterRes);

	let res: any;

	try {
		await consume(limiter, key, points);
	} catch (err) {
		res = err;
	}

	// 2. The earliest the caller may try again is now
	expect(res).toBeInstanceOf(HitRateLimitError);
	expect(res.extensions.reset).toEqual(systemTime);
	expect(res.message).not.toContain('-1');
});
