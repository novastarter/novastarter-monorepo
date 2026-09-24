/**
 * Tests of `errors/errors/invalid-credentials`.
 */
import { expect, test } from 'vitest';
import { InvalidCredentialsError } from './invalid-credentials.js';

test('Carries the code, the status and a fixed message', () => {
	// Credentials errors carry no details — the code and status are all a transport layer maps to a 401 — but a
	// cause can still ride along for the logs
	const error = new InvalidCredentialsError(undefined, { cause: 'signature' });

	expect(error.code).toBe('INVALID_CREDENTIALS');
	expect(error.status).toBe(401);
	expect(error.message).toBe('Invalid credentials.');
	expect(error.cause).toBe('signature');
});
