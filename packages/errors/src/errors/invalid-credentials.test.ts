/**
 * Tests of `errors/errors/invalid-credentials`.
 */
import { expect, test } from 'vitest';
import { InvalidCredentialsError } from './invalid-credentials.js';

test('Carries the code, the status and a fixed message', () => {
	const error = new InvalidCredentialsError(undefined, { cause: 'signature' });

	expect(error.code).toBe('INVALID_CREDENTIALS');
	expect(error.status).toBe(401);
	expect(error.message).toBe('Invalid credentials.');
	expect(error.cause).toBe('signature');
});
