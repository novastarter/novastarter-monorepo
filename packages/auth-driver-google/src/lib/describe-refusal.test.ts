/**
 * Tests of `describe-refusal`: how a refused response becomes the reason of an `AuthProviderFailedError`.
 */
import { describe, expect, test } from 'vitest';
import { describeRefusal } from './describe-refusal.js';

describe('describeRefusal', () => {
	test('Leads with the OAuth error and adds its description', () => {
		// 1. The error code is what tells a spent code from a wrong secret; the description is for the reader
		expect(
			describeRefusal('the token endpoint', {
				status: 400,
				ok: false,
				body: { error: 'invalid_grant', error_description: 'Bad Request' },
			}),
		).toBe('invalid_grant: Bad Request');

		expect(describeRefusal('the token endpoint', { status: 401, ok: false, body: { error: 'invalid_client' } })).toBe(
			'invalid_client',
		);
	});

	test('Falls back to the status for a body without an OAuth error', () => {
		// 1. No body, a body that is not an object, or an object without `error`: the status is all there is
		expect(describeRefusal('the token endpoint', { status: 503, ok: false, body: undefined })).toBe(
			'the token endpoint answered 503',
		);

		expect(describeRefusal('the key set', { status: 500, ok: false, body: 'oops' })).toBe('the key set answered 500');

		expect(describeRefusal('the key set', { status: 500, ok: false, body: { error: '' } })).toBe(
			'the key set answered 500',
		);
	});
});
