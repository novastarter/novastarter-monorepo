/**
 * Tests of `auth/errors/invalid-token`.
 */
import { isNovastarterError } from '@novastarter/errors';
import { expect, test } from 'vitest';
import { AuthInvalidTokenError } from './invalid-token.js';

test('Carries the code, the status and a message that does not say which check failed', () => {
	const error = new AuthInvalidTokenError();

	// One message for every case, so a caller probing tokens cannot tell a spent one from a forged one
	expect(error.code).toBe('AUTH_INVALID_TOKEN');
	expect(error.status).toBe(401);
	expect(error.message).toBe('The token is invalid or has expired');

	// Made by the kit's factory, so the shared type guard recognises it
	expect(isNovastarterError(error, 'AUTH_INVALID_TOKEN')).toBe(true);
});
