/**
 * Tests of `queue/lib/validate-delay`.
 */
import { describe, expect, test } from 'vitest';
import { validateJobDelay } from './validate-delay.js';

describe('validateJobDelay', () => {
	test('Passes a missing delay and a delay of zero or more', () => {
		// No delay means no wait, and a real wait of any length is what the option is for
		expect(() => validateJobDelay('mail.send', undefined)).not.toThrow();
		expect(() => validateJobDelay('mail.send', 0)).not.toThrow();
		expect(() => validateJobDelay('mail.send', 60_000)).not.toThrow();
	});

	test('Refuses a negative or NaN delay, naming the job and the got value', () => {
		// `NaN` fails the `>= 0` check along with the negatives, since `!(NaN >= 0)` is true; the message matches
		// the one the `local` driver has always thrown
		expect(() => validateJobDelay('mail.send', -1)).toThrow(RangeError);

		expect(() => validateJobDelay('mail.send', Number.NaN)).toThrow(
			'The delay of job "mail.send" must be 0 or more milliseconds, got NaN',
		);
	});

	test('Refuses an infinite delay, which would arm no timer a job could wait out', () => {
		// `Infinity` passes the `>= 0` check, but the `local` driver would re-arm its timer slices for ever and the
		// job would silently never run; both infinities are refused with the shared message
		expect(() => validateJobDelay('mail.send', Number.POSITIVE_INFINITY)).toThrow(
			'The delay of job "mail.send" must be 0 or more milliseconds, got Infinity',
		);

		expect(() => validateJobDelay('mail.send', Number.NEGATIVE_INFINITY)).toThrow(
			'The delay of job "mail.send" must be 0 or more milliseconds, got -Infinity',
		);
	});
});
