/**
 * Tests of `queue/lib/duration-to-cron`; `validateCron` checks the output and has tests of its own in
 * `validate-cron.test.ts`.
 */
import { describe, expect, test } from 'vitest';
import { durationToCron } from './duration-to-cron.js';
import { validateCron } from './validate-cron.js';

describe('durationToCron', () => {
	test('Honours the hourly intervals with a random phase offset', () => {
		// Twenty rounds each: the phase offset is random, so a single round could pass by luck
		for (let round = 0; round < 20; round++) {
			expect(durationToCron(3600)).toMatch(/^\d{1,2} \d{1,2} \*\/1 \* \* \*$/);
			expect(durationToCron(7200)).toMatch(/^\d{1,2} \d{1,2} [01]-23\/2 \* \* \*$/);
			expect(durationToCron(12 * 3600)).toMatch(/^\d{1,2} \d{1,2} (\d|1[01])-23\/12 \* \* \*$/);
		}
	});

	test('Falls back to daily for anything else', () => {
		// An interval that does not divide a day stays schedulable by becoming one run a day
		expect(durationToCron(7 * 3600)).toMatch(/^\d{1,2} \d{1,2} (\d|1\d|2[0-3]) \* \* \*$/);
		expect(durationToCron(90)).toMatch(/^\d{1,2} \d{1,2} (\d|1\d|2[0-3]) \* \* \*$/);
		expect(durationToCron(0)).toMatch(/^\d{1,2} \d{1,2} (\d|1\d|2[0-3]) \* \* \*$/);
	});

	test('Produces expressions croner accepts', () => {
		// Whatever the duration, the output must be a rule the scheduler actually parses
		for (const duration of [3600, 7200, 3 * 3600, 25200, 60]) {
			expect(validateCron(durationToCron(duration))).toBe(true);
		}
	});
});
