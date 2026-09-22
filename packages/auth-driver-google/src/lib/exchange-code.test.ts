/**
 * Tests of `exchange-code`: the form sent to Google's token endpoint and how its answers are read.
 */
import { AuthProviderFailedError } from '@novastarter/auth';
import { describe, expect, test, vi } from 'vitest';
import { TOKEN_URL } from './constants.js';
import { exchangeCode } from './exchange-code.js';
import type { AuthFetch } from './request.js';

/**
 * The exchange of every test.
 */
const params = {
	code: 'code-1',
	codeVerifier: 'verifier-1',
	redirectUri: 'https://acme.test/callback',
	clientId: 'client-1',
	clientSecret: 'secret-1',
};

/**
 * A fetch that answers once with the given status and JSON body.
 *
 * @param status - The HTTP status.
 * @param body - The body, serialised as JSON.
 * @returns The fake fetch, a spy.
 */
const answer = (status: number, body: unknown) =>
	vi.fn<AuthFetch>(async () => ({ status, ok: status < 300, text: async () => JSON.stringify(body) }));

describe('exchangeCode', () => {
	test('Posts the code, the verifier and the credentials as a form and answers the ID token', async () => {
		const fetch = answer(200, { access_token: 'at', id_token: 'id.token.1', token_type: 'Bearer' });

		expect(await exchangeCode({ fetch, timeout: 1_000 }, params)).toBe('id.token.1');

		// 1. Every field of an authorization-code grant with PKCE, form-encoded
		const [url, init] = fetch.mock.calls[0]!;

		expect(url).toBe(TOKEN_URL);
		expect(init.method).toBe('POST');
		expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

		expect(Object.fromEntries(new URLSearchParams(init.body))).toStrictEqual({
			grant_type: 'authorization_code',
			code: 'code-1',
			client_id: 'client-1',
			client_secret: 'secret-1',
			redirect_uri: 'https://acme.test/callback',
			code_verifier: 'verifier-1',
		});
	});

	test('Throws a provider failure naming the OAuth error of a refusal', async () => {
		// 1. A spent or forged code is `invalid_grant`, which the reason carries
		const fetch = answer(400, { error: 'invalid_grant', error_description: 'Bad Request' });
		const error = await exchangeCode({ fetch, timeout: 1_000 }, params).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(AuthProviderFailedError);
		expect(error).toMatchObject({ message: 'The google sign-in failed: invalid_grant: Bad Request' });
	});

	test('Throws a provider failure for an answer without an ID token', async () => {
		// 1. Without `openid` Google sends an access token alone; the identity cannot be read from it
		await expect(exchangeCode({ fetch: answer(200, { access_token: 'at' }), timeout: 1_000 }, params)).rejects.toThrow(
			'The google sign-in failed: the token response carried no id_token',
		);
	});
});
