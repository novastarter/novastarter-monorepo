/**
 * Tests of `build-authorize-url`: the parameters of GitHub's consent URL and which scopes it asks for.
 */
import { describe, expect, test } from 'vitest';
import { buildAuthorizeUrl } from './build-authorize-url.js';
import { AUTHORIZE_URL, DEFAULT_SCOPES } from './constants.js';

/**
 * What `startOAuth()` hands the driver, without scopes of its own.
 */
const params = {
	state: 'state-1',
	codeChallenge: 'challenge-1',
	nonce: 'nonce-1',
	redirectUri: 'https://acme.test/auth/github/callback',
};

describe('buildAuthorizeUrl', () => {
	test('Carries the client, the redirect, the scopes, the state and the S256 challenge, and no nonce', () => {
		const url = buildAuthorizeUrl(params, 'client-1', DEFAULT_SCOPES);

		// GitHub issues no ID token, so the nonce has no place in the URL
		expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL);

		expect(Object.fromEntries(url.searchParams)).toStrictEqual({
			client_id: 'client-1',
			redirect_uri: 'https://acme.test/auth/github/callback',
			scope: 'read:user user:email',
			state: 'state-1',
			code_challenge: 'challenge-1',
			code_challenge_method: 'S256',
		});
	});

	test('Lets the call scopes win over the location', () => {
		// The call's list replaces the location's as it is; nothing is added to it
		expect(
			buildAuthorizeUrl({ ...params, scopes: ['read:user'] }, 'client-1', DEFAULT_SCOPES).searchParams.get('scope'),
		).toBe('read:user');
	});
});
