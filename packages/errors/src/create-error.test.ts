/**
 * Tests of `errors/create-error`.
 */
import { beforeEach, expect, test, vi } from 'vitest';
import { createError } from './create-error.js';

/**
 * Inputs every test builds its error from.
 *
 * Reset in `beforeEach`, so a test mutating it cannot change what the next test sees.
 */
let sample: {
	code: string;
	status: number;
	message: string;
	extensionKey: string;
	extensionValue: string;
};

beforeEach(() => {
	// 1. Fresh values per test: the code is lower-case on purpose, to prove the factory upper-cases it
	sample = {
		code: 'test_error',
		status: 400,
		message: 'Test error message',
		extensionKey: 'testKey',
		extensionValue: 'testValue',
	};
});

test('Returns enhanced error object', () => {
	// 1. The shared shape every error made by the factory carries: name for the guard, code for matching, status
	//    for the transport layer
	const TestError = createError(sample.code, sample.message, sample.status);
	const error = new TestError();

	expect(error.name).toBe('NovastarterError');
	expect(error.code).toBe('TEST_ERROR');
	expect(error.message).toBe(sample.message);
	expect(error.status).toBe(sample.status);
});

test('Allows passing message as callback function', () => {
	// 1. A function message is resolved per instance, so the text can depend on the extensions
	const TestError = createError(sample.code, () => sample.message, sample.status);
	const error = new TestError();
	expect(error.message).toBe(sample.message);
});

test('Passes extensions to custom message function', () => {
	// 1. The extensions are handed to the message function, so the text can name what failed
	const messageGenerator = vi.fn().mockReturnValue(sample.message);
	const extensions = { [sample.extensionKey]: sample.extensionValue };
	const TestError = createError<{ [key: string]: unknown }>(sample.code, messageGenerator, sample.status);

	new TestError(extensions);

	expect(messageGenerator).toHaveBeenCalledWith(extensions);
});

test('Makes extensions available', () => {
	// 1. The same object the caller passed is kept on the instance, by reference, for consumers reading after catch
	const messageGenerator = vi.fn().mockReturnValue(sample.message);
	const extensions = { [sample.extensionKey]: sample.extensionValue };
	const TestError = createError<{ [key: string]: unknown }>(sample.code, messageGenerator, sample.status);

	const error = new TestError(extensions);

	expect(error.extensions).toBe(extensions);
});

test('Overrides toString', () => {
	// 1. Logs read `name [CODE]: message`, so the code is findable without extra formatting
	const TestError = createError(sample.code, sample.message, sample.status);

	const error = new TestError();

	expect(error.toString()).toBe(`NovastarterError [${sample.code.toUpperCase()}]: ${sample.message}`);
});
