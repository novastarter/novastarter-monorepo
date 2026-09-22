/**
 * Tests of `auth/errors/provider-failed`.
 */
import { isNovastarterError } from '@novastarter/errors';
import { expect, test } from 'vitest';
import { AuthProviderFailedError } from './provider-failed.js';

test('Carries the code, the status, the provider and the reason in the message', () => {
	const cause = new Error('400 Bad Request');
	const error = new AuthProviderFailedError({ provider: 'github', reason: 'bad_verification_code' }, { cause });

	// 1. The upstream failed, not the request: 502, and the provider's own error as the cause
	expect(error.code).toBe('AUTH_PROVIDER_FAILED');
	expect(error.status).toBe(502);
	expect(error.message).toBe('The github sign-in failed: bad_verification_code');
	expect(error.extensions).toStrictEqual({ provider: 'github', reason: 'bad_verification_code' });
	expect(error.cause).toBe(cause);

	// 2. Made by the kit's factory, so the shared type guard recognises it
	expect(isNovastarterError(error, 'AUTH_PROVIDER_FAILED')).toBe(true);
});
