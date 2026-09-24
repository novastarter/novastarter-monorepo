/**
 * Tests of `exchange-code`: the form sent to GitHub's token endpoint and how its answers — including a refusal hidden
 * in a `200` — are read.
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
	test('Posts the code, the verifier and the credentials, asking for JSON, and answers the access token', async () => {
		const fetch = answer(200, { access_token: 'gho_1', token_type: 'bearer', scope: 'read:user,user:email' });

		expect(await exchangeCode({ fetch, timeout: 1_000 }, params)).toStrictEqual({
			accessToken: 'gho_1',
			scope: ['read:user', 'user:email'],
			tokenType: 'bearer',
		});

		// Without `Accept: application/json` GitHub answers form-encoded
		const [url, init] = fetch.mock.calls[0]!;

		expect(url).toBe(TOKEN_URL);
		expect(init.method).toBe('POST');
		expect(init.headers['Accept']).toBe('application/json');

		expect(Object.fromEntries(new URLSearchParams(init.body as string))).toStrictEqual({
			client_id: 'client-1',
			client_secret: 'secret-1',
			code: 'code-1',
			redirect_uri: 'https://acme.test/callback',
			code_verifier: 'verifier-1',
		});
	});

	test('Answers the refresh token and the expiry of an expiring user token', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(1_000_000);

		// A GitHub App with expiring tokens adds both; an empty scope is no scopes
		const fetch = answer(200, {
			access_token: 'ghu_1',
			refresh_token: 'ghr_1',
			expires_in: 28_800,
			refresh_token_expires_in: 15_897_600,
			scope: '',
			token_type: 'bearer',
		});

		expect(await exchangeCode({ fetch, timeout: 1_000 }, params)).toStrictEqual({
			accessToken: 'ghu_1',
			refreshToken: 'ghr_1',
			expiresAt: 1_000_000 + 28_800_000,
			scope: [],
			tokenType: 'bearer',
		});

		vi.useRealTimers();
	});

	test('Throws a provider failure for a refusal answered with 200', async () => {
		// GitHub's own way of refusing a code: a successful status with an error in the body
		const fetch = answer(200, {
			error: 'bad_verification_code',
			error_description: 'The code passed is incorrect or expired.',
		});

		const error = await exchangeCode({ fetch, timeout: 1_000 }, params).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(AuthProviderFailedError);

		expect(error).toMatchObject({
			message: 'The github sign-in failed: bad_verification_code: The code passed is incorrect or expired.',
		});
	});

	test('Throws a provider failure for an error status and for an answer without a token', async () => {
		// A gateway error has no OAuth error, so the status is the reason
		await expect(exchangeCode({ fetch: answer(502, undefined), timeout: 1_000 }, params)).rejects.toThrow(
			'the token endpoint answered 502',
		);

		await expect(exchangeCode({ fetch: answer(200, {}), timeout: 1_000 }, params)).rejects.toThrow(
			'the token response carried no access_token',
		);
	});
});
