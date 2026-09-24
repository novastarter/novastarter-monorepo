/**
 * Tests of the Stripe timestamp helper: seconds since the epoch, or nothing, as a `Date` or `null`.
 */
import { describe, expect, test } from 'vitest';
import { fromUnix } from './from-unix.js';

describe('fromUnix', () => {
	test('Turns seconds into a Date and nothing into null', () => {
		expect(fromUnix(1789084800)).toStrictEqual(new Date('2026-09-11T00:00:00.000Z'));

		// Zero is the epoch, a real instant, not an unset value.
		expect(fromUnix(0)).toStrictEqual(new Date(0));

		// Stripe sends `null` for an unset timestamp and an absent field reads as `undefined`; both become `null`, so
		// callers can store the value in a nullable column without a second check.
		expect(fromUnix(null)).toBeNull();
		expect(fromUnix(undefined)).toBeNull();
	});
});
