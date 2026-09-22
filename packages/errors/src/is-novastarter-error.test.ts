/**
 * Tests of `errors/is-novastarter-error`.
 */
import { beforeEach, expect, expectTypeOf, test } from 'vitest';
import { ErrorCode } from './codes.js';
import { createError } from './create-error.js';
import { HitRateLimitError, type HitRateLimitErrorExtensions } from './errors/hit-rate-limit.js';
import { InvalidPayloadError, type InvalidPayloadErrorExtensions } from './errors/invalid-payload.js';
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

test('Narrows the extensions of every kit code that carries details', () => {
	// 1. Both errors are typed `unknown`, the way they arrive in a `catch`, so only the guard can narrow them
	const payload: unknown = new InvalidPayloadError({ reason: 'Field "email" is required' });
	const rateLimit: unknown = new HitRateLimitError({ limit: 10, reset: new Date(Date.now() + 5_000) });

	// 2. Every branch below must run, or a guard returning `false` would pass the test without checking a type
	expect.assertions(4);

	// 3. A kit code missing from the extensions map narrows to `never`, and reading a field then fails to compile,
	//    so the field access is the regression check here, not only the type assertion
	if (isNovastarterError(payload, ErrorCode.InvalidPayload)) {
		expectTypeOf(payload.extensions).toEqualTypeOf<InvalidPayloadErrorExtensions>();
		expect(payload.extensions.reason).toBe('Field "email" is required');
		expect(payload.status).toBe(400);
	}

	if (isNovastarterError(rateLimit, ErrorCode.RequestsExceeded)) {
		expectTypeOf(rateLimit.extensions).toEqualTypeOf<HitRateLimitErrorExtensions>();
		expect(rateLimit.extensions.limit).toBe(10);
		expect(rateLimit.status).toBe(429);
	}
});

test('Narrows a custom code to the extensions type the caller names', () => {
	// 1. A code outside `ErrorCode` has no map entry, so the type has to come from the call site
	const InvalidThingError = createError<{ thing: string }>(
		'INVALID_THING',
		({ thing }) => `Thing "${thing}" is invalid.`,
		400,
	);

	const error: unknown = new InvalidThingError({ thing: 'foo' });

	// 2. Every branch below must run, or a guard returning `false` would pass the test without checking a type
	expect.assertions(2);

	// 3. With the type parameter the extensions are readable, which is the shape the readme example relies on
	if (isNovastarterError<{ thing: string }>(error, 'INVALID_THING')) {
		expectTypeOf(error.extensions).toEqualTypeOf<{ thing: string }>();
		expect(error.extensions.thing).toBe('foo');
	}

	// 4. Without it the guard cannot know the details and must leave them `unknown` rather than guess
	if (isNovastarterError(error, 'INVALID_THING')) {
		expectTypeOf(error.extensions).toEqualTypeOf<unknown>();
		expect(error.status).toBe(400);
	}
});
