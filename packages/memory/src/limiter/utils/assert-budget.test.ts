/**
 * Tests of `memory/limiter/utils/assert-budget`.
 */
import { describe, expect, test } from 'vitest';
import { assertBudget } from './assert-budget.js';

describe('duration', () => {
	test('Accepts a whole number of seconds of at least 1', () => {
		// 1. The shortest and a long window both pass
		expect(() => assertBudget('Driver', { duration: 1, points: 5 })).not.toThrow();
		expect(() => assertBudget('Driver', { duration: 3600, points: 5 })).not.toThrow();
	});

	test('Refuses a fraction, zero, a negative and a non-finite value', () => {
		// 1. A fraction would be a sub-second window in memory and no window at all in Redis
		expect(() => assertBudget('Driver', { duration: 0.5, points: 5 })).toThrow(RangeError);
		expect(() => assertBudget('Driver', { duration: 1.9, points: 5 })).toThrow(RangeError);

		// 2. Zero and below would never restore the points
		expect(() => assertBudget('Driver', { duration: 0, points: 5 })).toThrow(RangeError);
		expect(() => assertBudget('Driver', { duration: -1, points: 5 })).toThrow(RangeError);

		// 3. `NaN` and `Infinity` are not seconds
		expect(() => assertBudget('Driver', { duration: Number.NaN, points: 5 })).toThrow(RangeError);
		expect(() => assertBudget('Driver', { duration: Number.POSITIVE_INFINITY, points: 5 })).toThrow(RangeError);
	});

	test('Names the driver and the value in the message', () => {
		// 1. The message has to point at the location's configuration, not at the library
		expect(() => assertBudget('LimiterDriverRedis', { duration: 0.5, points: 5 })).toThrow(
			'LimiterDriverRedis: "duration" must be a whole number of seconds of at least 1, got 0.5',
		);
	});
});

describe('points', () => {
	test('Accepts a whole number of at least 0', () => {
		// 1. Zero is a budget too: a key that is always over it
		expect(() => assertBudget('Driver', { duration: 1, points: 0 })).not.toThrow();
		expect(() => assertBudget('Driver', { duration: 1, points: 50 })).not.toThrow();
	});

	test('Refuses a fraction, a negative and a non-finite value', () => {
		// 1. The library would silently turn a negative budget into 4 points
		expect(() => assertBudget('Driver', { duration: 1, points: -1 })).toThrow(RangeError);

		// 2. A point is consumed whole, so a fractional budget has no meaning
		expect(() => assertBudget('Driver', { duration: 1, points: 2.5 })).toThrow(RangeError);

		// 3. `NaN` and `Infinity` are not a budget
		expect(() => assertBudget('Driver', { duration: 1, points: Number.NaN })).toThrow(RangeError);
		expect(() => assertBudget('Driver', { duration: 1, points: Number.POSITIVE_INFINITY })).toThrow(RangeError);
	});
});
