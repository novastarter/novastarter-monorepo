/**
 * Tests of `queue/lib/validate-cron`.
 */
import { describe, expect, test } from 'vitest';
import { validateCron } from './validate-cron.js';

describe('validateCron', () => {
	test.each([
		['0 3 * * *', true],
		['*/5 * * * *', true],
		['30 0 3 * * *', true],
		['@daily', true],
		['', false],
		['every day', false],
		['0 3 * *', false],
		['0 0 3 * * * 2026', false],
	])('%s → %s', (rule, expected) => {
		// The rule is what a schedule variable carries; the expected answer is whether croner accepts it
		expect(validateCron(rule)).toBe(expected);
	});
});
