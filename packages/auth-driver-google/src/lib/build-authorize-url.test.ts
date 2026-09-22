/**
 * Tests of `build-authorize-url`: the parameters of Google's consent URL and which scopes it asks for.
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
	redirectUri: 'https://acme.test/auth/google/callback?from=login',
};

describe('buildAuthorizeUrl', () => {
	test('Carries the client, the redirect, the state, the S256 challenge and the nonce', () => {
		const url = buildAuthorizeUrl(params, 'client-1', DEFAULT_SCOPES);

		// 1. Every parameter Google needs for an OpenID Connect code flow with PKCE; the redirect keeps its own query
		expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL);

		expect(Object.fromEntries(url.searchParams)).toStrictEqual({
			response_type: 'code',
			client_id: 'client-1',
			redirect_uri: 'https://acme.test/auth/google/callback?from=login',
			scope: 'openid email profile',
			state: 'state-1',
			code_challenge: 'challenge-1',
			code_challenge_method: 'S256',
			nonce: 'nonce-1',
		});
	});

	test('Lets the call scopes win over the location and adds openid when missing', () => {
		// 1. The call names its own scopes; without `openid` Google would issue no ID token, so it is added
		expect(
			buildAuthorizeUrl({ ...params, scopes: ['email'] }, 'client-1', DEFAULT_SCOPES).searchParams.get('scope'),
		).toBe('openid email');

		// 2. The location's scopes apply when the call has none, kept as they are when `openid` is among them
		expect(buildAuthorizeUrl(params, 'client-1', ['email', 'openid']).searchParams.get('scope')).toBe('email openid');
	});
});
