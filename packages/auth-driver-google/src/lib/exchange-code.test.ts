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

		expect(await exchangeCode({ fetch, timeout: 1_000 }, params)).toStrictEqual({
			idToken: 'id.token.1',
			tokens: { accessToken: 'at', tokenType: 'Bearer' },
		});

		const [url, init] = fetch.mock.calls[0]!;

		expect(url).toBe(TOKEN_URL);
		expect(init.method).toBe('POST');
		expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

		expect(Object.fromEntries(new URLSearchParams(init.body as string))).toStrictEqual({
			grant_type: 'authorization_code',
			code: 'code-1',
			client_id: 'client-1',
			client_secret: 'secret-1',
			redirect_uri: 'https://acme.test/callback',
			code_verifier: 'verifier-1',
		});
	});

	test('Answers the refresh token, the expiry and the granted scopes beside the ID token', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(1_000_000);

		// Offline access adds the refresh token; the scopes come space-separated
		const fetch = answer(200, {
			access_token: 'ya29.at',
			refresh_token: '1//rt',
			expires_in: 3599,
			scope: 'openid https://www.googleapis.com/auth/userinfo.email',
			token_type: 'Bearer',
			id_token: 'id.token.1',
		});

		expect(await exchangeCode({ fetch, timeout: 1_000 }, params)).toStrictEqual({
			idToken: 'id.token.1',
			tokens: {
				accessToken: 'ya29.at',
				refreshToken: '1//rt',
				expiresAt: 1_000_000 + 3_599_000,
				scope: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
				tokenType: 'Bearer',
			},
		});

		vi.useRealTimers();

		expect(
			await exchangeCode({ fetch: answer(200, { id_token: 'id.token.2' }), timeout: 1_000 }, params),
		).toStrictEqual({ idToken: 'id.token.2' });
	});

	test('Throws a provider failure naming the OAuth error of a refusal', async () => {
		const fetch = answer(400, { error: 'invalid_grant', error_description: 'Bad Request' });
		const error = await exchangeCode({ fetch, timeout: 1_000 }, params).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(AuthProviderFailedError);
		expect(error).toMatchObject({ message: 'The google sign-in failed: invalid_grant: Bad Request' });
	});

	test('Throws a provider failure for an answer without an ID token', async () => {
		// Without `openid` Google sends an access token alone, and the identity cannot be read from it
		await expect(exchangeCode({ fetch: answer(200, { access_token: 'at' }), timeout: 1_000 }, params)).rejects.toThrow(
			'The google sign-in failed: the token response carried no id_token',
		);
	});
});
