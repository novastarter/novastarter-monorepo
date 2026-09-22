/**
 * Tests of `errors/errors/hit-rate-limit`.
 */
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { hitRateLimitMessage } from './hit-rate-limit.js';

beforeAll(() => {
	// 1. A fixed clock, so the duration in the message is stable enough to snapshot
	vi.useFakeTimers();
	vi.setSystemTime('2023-05-31T14:45:00Z');
});

afterAll(() => {
	// 1. The fake clock must not leak into the other test files of the process
	vi.useRealTimers();
});

test('Constructs message', () => {
	// 1. Thirty seconds after the fixed now, reported in a human-readable duration
	expect(
		hitRateLimitMessage({
			limit: 100,
			reset: new Date('2023-05-31T14:45:30Z'),
		}),
	).toMatchInlineSnapshot('"Too many requests, retry after 30s."');
});

test('Clamps a reset in the past to "retry now"', () => {
	// 1. A stale reset is answered with a zero wait rather than a negative duration the client cannot act on
	expect(
		hitRateLimitMessage({
			limit: 100,
			reset: new Date('2023-05-31T14:44:30Z'),
		}),
	).toMatchInlineSnapshot('"Too many requests, retry after 0ms."');
});

test('Treats an invalid reset Date as "retry now" instead of throwing', () => {
	// 1. `ms(NaN)` throws, and the error constructor must not blow up while reporting another error
	expect(
		hitRateLimitMessage({
			limit: 100,
			reset: new Date('not-a-date'),
		}),
	).toMatchInlineSnapshot('"Too many requests, retry after 0ms."');
});
