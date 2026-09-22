/**
 * Tests of the Google driver class on an injected fetch and a local key set: the consent URL, a whole callback from
 * code to identity, the checks that refuse a callback, the configuration it refuses and `verify()`. The URL builder,
 * the exchange, the token verification and the claim mapping have their own tests next to their modules.
 */
import { AuthProviderFailedError } from '@novastarter/auth';
import { createLocalJWKSet, type CryptoKey, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { JWKS_URL, TOKEN_URL } from './constants.js';
import { AuthDriverGoogle } from './driver.js';
import type { AuthFetch } from './request.js';

/**
 * The key Google would sign with, and the local set holding its public half.
 */
let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
	// 1. One RS256 pair for the whole file: generating keys is the slow part
	const pair = await generateKeyPair('RS256');

	privateKey = pair.privateKey;
	jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
});

/**
 * Sign an ID token for `client-1` the way Google does.
 *
 * @param nonce - The nonce claim.
 * @returns The compact JWT.
 */
const idToken = (nonce: string): Promise<string> =>
	new SignJWT({ nonce, email: 'ada@example.com', email_verified: true, name: 'Ada', picture: 'https://p.test/a' })
		.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
		.setIssuer('https://accounts.google.com')
		.setAudience('client-1')
		.setSubject('1234567890')
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(privateKey);

/**
 * A fetch that answers once with the given status and JSON body.
 *
 * @param status - The HTTP status.
 * @param body - The body, serialised as JSON.
 * @returns The fake fetch, a spy.
 */
const answer = (status: number, body: unknown) =>
	vi.fn<AuthFetch>(async () => ({ status, ok: status < 300, text: async () => JSON.stringify(body) }));

/**
 * What `finishOAuth()` hands the driver.
 */
const callbackParams = {
	code: 'code-1',
	codeVerifier: 'verifier-1',
	nonce: 'nonce-1',
	redirectUri: 'https://acme.test/auth/google/callback',
};

describe('AuthDriverGoogle', () => {
	test('Builds the consent URL with the location scopes', async () => {
		const driver = new AuthDriverGoogle({ clientId: 'client-1', clientSecret: 'secret-1', scopes: ['email'], jwks });

		const url = await driver.authorize({
			state: 'state-1',
			codeChallenge: 'challenge-1',
			nonce: 'nonce-1',
			redirectUri: 'https://acme.test/auth/google/callback',
		});

		// 1. The location's scope, with `openid` added so an ID token comes back
		expect(url.searchParams.get('scope')).toBe('openid email');
		expect(url.searchParams.get('client_id')).toBe('client-1');
		expect(defaultExport).toBe(AuthDriverGoogle);
	});

	test('Exchanges the code and answers the identity of the verified ID token', async () => {
		const fetch = answer(200, { access_token: 'at', id_token: await idToken('nonce-1') });
		const driver = new AuthDriverGoogle({ clientId: 'client-1', clientSecret: 'secret-1', fetch, jwks });

		// 1. The whole callback: one request to the token endpoint, the rest is read from the signed token
		expect(await driver.callback(callbackParams)).toMatchObject({
			provider: 'google',
			subject: '1234567890',
			email: 'ada@example.com',
			emailVerified: true,
			name: 'Ada',
			avatarUrl: 'https://p.test/a',
		});

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]![0]).toBe(TOKEN_URL);
		expect(new URLSearchParams(fetch.mock.calls[0]![1].body).get('code_verifier')).toBe('verifier-1');
	});

	test('Refuses a refused code and a token from another sign-in', async () => {
		// 1. Google refuses the code: the OAuth error is the reason
		const refused = new AuthDriverGoogle({
			clientId: 'client-1',
			clientSecret: 'secret-1',
			fetch: answer(400, { error: 'invalid_grant' }),
			jwks,
		});

		await expect(refused.callback(callbackParams)).rejects.toBeInstanceOf(AuthProviderFailedError);

		// 2. A token signed for another nonce is refused, however good its signature
		const replayed = new AuthDriverGoogle({
			clientId: 'client-1',
			clientSecret: 'secret-1',
			fetch: answer(200, { id_token: await idToken('nonce-2') }),
			jwks,
		});

		await expect(replayed.callback(callbackParams)).rejects.toThrow('the ID token nonce does not match');
	});

	test('Refuses missing credentials and a timeout a timer cannot hold', () => {
		// 1. Each missing option is named, so the fix is obvious from the message
		expect(() => new AuthDriverGoogle({ clientId: '', clientSecret: 'secret-1' })).toThrow(
			'The google auth driver needs a "clientId"',
		);

		expect(() => new AuthDriverGoogle({ clientId: 'client-1', clientSecret: '' })).toThrow(
			'The google auth driver needs a "clientSecret"',
		);

		// 2. Zero, fractions and values past the timer's bound would fail every request; they are refused up front
		for (const timeout of [0, 1.5, 2 ** 31, Number.NaN]) {
			expect(() => new AuthDriverGoogle({ clientId: 'client-1', clientSecret: 'secret-1', timeout })).toThrow(
				RangeError,
			);
		}
	});

	test('Verifies by reading the key set', async () => {
		// 1. A set with keys passes, and it is Google's URL that was read
		const fetch = answer(200, { keys: [{ kty: 'RSA', kid: 'k1' }] });

		await expect(
			new AuthDriverGoogle({ clientId: 'client-1', clientSecret: 'secret-1', fetch }).verify(),
		).resolves.toBeUndefined();

		expect(fetch.mock.calls[0]![0]).toBe(JWKS_URL);

		// 2. An empty set or a refusal fails the check
		await expect(
			new AuthDriverGoogle({
				clientId: 'client-1',
				clientSecret: 'secret-1',
				fetch: answer(200, { keys: [] }),
			}).verify(),
		).rejects.toThrow('the key set has no keys');

		await expect(
			new AuthDriverGoogle({ clientId: 'client-1', clientSecret: 'secret-1', fetch: answer(503, {}) }).verify(),
		).rejects.toThrow('the key set answered 503');
	});
});
