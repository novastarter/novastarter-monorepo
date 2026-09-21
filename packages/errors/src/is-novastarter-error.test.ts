/**
 * Tests of `errors/is-novastarter-error`.
 */
import { beforeEach, expect, test } from 'vitest';
import { createError } from './create-error.js';
import { isNovastarterError } from './is-novastarter-error.js';

let sample: {
	code: string;
	status: number;
	message: string;
};

beforeEach(() => {
	sample = {
		code: 'test_error',
		status: 400,
		message: 'Test error message',
	};
});

test('Reports false for non Novastarter-errors', () => {
	const negative = [
		false,
		() => {
			/* empty */
		},
		[],
		new Error(),
		0,
		null,
		undefined,
		new Set(),
	];

	for (const input of negative) {
		expect(isNovastarterError(input)).toBe(false);
	}
});

test('Reports true for Novastarter error', () => {
	const SampleError = createError(sample.code, sample.message, sample.status);
	const error = new SampleError();
	expect(isNovastarterError(error)).toBe(true);
});

test('Check against optional error code', () => {
	const SampleError = createError(sample.code, sample.message, sample.status);
	const error = new SampleError();
	expect(isNovastarterError(error, sample.code)).toBe(true);
	expect(isNovastarterError(error, 'different_code')).toBe(false);
});
