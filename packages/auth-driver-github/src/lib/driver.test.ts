/**
 * Tests of the GitHub driver class on an injected fetch: the consent URL, a whole callback from code to identity and
 * tokens, a refused code, the configuration it refuses, and `call()` of the REST API. The URL builder, the exchange,
 * the profile requests, the address pick and the mapping have their own tests next to their modules.
 */
import { AuthProviderFailedError } from '@novastarter/auth';
import { HitRateLimitError, InvalidConfigError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { describe, expect, test, vi } from 'vitest';
import * as entry from '../index.js';
import { EMAILS_URL, TOKEN_URL, USER_URL } from './constants.js';
import { AuthDriverGithub } from './driver.js';
import type { AuthFetch } from './request.js';

/**
 * A fetch that answers by URL.
 *
 * @param routes - The status and body per URL.
 * @returns The fake fetch, a spy.
 */
const routed = (routes: Record<string, { status: number; body: unknown }>) =>
	vi.fn<AuthFetch>(async (url) => {
		// An unrouted URL is a test mistake, answered with a 599 so it cannot pass silently
		const route = routes[url] ?? { status: 599, body: undefined };

		return { status: route.status, ok: route.status < 300, text: async () => JSON.stringify(route.body) };
	});

/**
 * A fetch that answers every request with one real `Response`, for `call()`, which reads the headers too.
 *
 * @param status - The HTTP status.
 * @param body - The body: a string as it is, anything else as JSON; `undefined` for none.
 * @param headers - The response headers.
 * @returns The fake fetch, a spy.
 */
const answer = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
	vi.fn<AuthFetch>(async () => {
		// `Response` refuses a body for a 204
		if (body === undefined) {
			return new Response(null, { status, headers });
		}

		return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
	});

/**
 * The app's credentials of every `call()` test; the secret must never show up in an error.
 */
const credentials = { clientId: 'client-1', clientSecret: 'secret-of-the-app' };

/**
 * A person's access token; it must never show up in an error either.
 */
const ACCESS_TOKEN = 'gho_person-access-token';

/**
 * What `finishOAuth()` hands the driver.
 */
const callbackParams = {
	code: 'code-1',
	codeVerifier: 'verifier-1',
	nonce: 'nonce-1',
	redirectUri: 'https://acme.test/auth/github/callback',
};

describe('AuthDriverGithub', () => {
	test('Builds the consent URL with the location scopes', async () => {
		const driver = new AuthDriverGithub({ clientId: 'client-1', clientSecret: 'secret-1', scopes: ['read:user'] });

		const url = await driver.authorize({
			state: 'state-1',
			codeChallenge: 'challenge-1',
			nonce: 'nonce-1',
			redirectUri: 'https://acme.test/auth/github/callback',
		});

		expect(url.searchParams.get('scope')).toBe('read:user');
		expect(url.searchParams.get('client_id')).toBe('client-1');
		expect(entry.AuthDriverGithub).toBe(AuthDriverGithub);
	});

	test('Exchanges the code and answers the identity read from the REST API, with the tokens', async () => {
		const fetch = routed({
			[TOKEN_URL]: { status: 200, body: { access_token: 'gho_1', token_type: 'bearer', scope: 'read:user,repo' } },
			[USER_URL]: { status: 200, body: { id: 583231, login: 'octocat', name: null, avatar_url: 'https://a.test/1' } },
			[EMAILS_URL]: { status: 200, body: [{ email: 'octo@example.com', primary: true, verified: true }] },
		});

		const driver = new AuthDriverGithub({ clientId: 'client-1', clientSecret: 'secret-1', fetch });

		expect(await driver.callback(callbackParams)).toMatchObject({
			provider: 'github',
			subject: '583231',
			email: 'octo@example.com',
			emailVerified: true,
			name: 'octocat',
			avatarUrl: 'https://a.test/1',
			tokens: { accessToken: 'gho_1', scope: ['read:user', 'repo'], tokenType: 'bearer' },
		});

		expect(fetch.mock.calls.map(([url]) => url).sort()).toStrictEqual([EMAILS_URL, TOKEN_URL, USER_URL].sort());
		expect(new URLSearchParams(fetch.mock.calls[0]![1].body as string).get('code_verifier')).toBe('verifier-1');
	});

	test('Refuses a code GitHub refused, without reading the profile', async () => {
		// GitHub refuses a code with a 200 and an error in the body
		const fetch = routed({ [TOKEN_URL]: { status: 200, body: { error: 'bad_verification_code' } } });
		const driver = new AuthDriverGithub({ clientId: 'client-1', clientSecret: 'secret-1', fetch });

		await expect(driver.callback(callbackParams)).rejects.toBeInstanceOf(AuthProviderFailedError);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test('Refuses missing credentials and a timeout a timer cannot hold', () => {
		expect(() => new AuthDriverGithub({ clientId: '', clientSecret: 'secret-1' })).toThrow(
			'The github auth driver needs a "clientId"',
		);

		expect(() => new AuthDriverGithub({ clientId: 'client-1', clientSecret: '' })).toThrow(
			'The github auth driver needs a "clientSecret"',
		);

		// Zero, fractions and values past the timer's bound would fail every request
		for (const timeout of [0, 1.5, 2 ** 31, Number.NaN]) {
			expect(() => new AuthDriverGithub({ clientId: 'client-1', clientSecret: 'secret-1', timeout })).toThrow(
				InvalidConfigError,
			);
		}
	});

	describe('call', () => {
		test('Requests the REST API as the person with their token and GitHub headers, the params as the query', async () => {
			const fetch = answer(200, [{ id: 1, full_name: 'octo/hello' }]);
			const driver = new AuthDriverGithub({ ...credentials, fetch });

			const { data: repos } = await driver.call(
				'GET /user/repos',
				{ per_page: 100, sort: 'updated' },
				{
					accessToken: ACCESS_TOKEN,
				},
			);

			expect(repos).toStrictEqual([{ id: 1, full_name: 'octo/hello' }]);

			const [url, init] = fetch.mock.calls[0]!;

			expect(url).toBe('https://api.github.com/user/repos?per_page=100&sort=updated');
			expect(init.method).toBe('GET');
			expect(init.body).toBeUndefined();

			expect(init.headers).toMatchObject({
				accept: 'application/vnd.github+json',
				'x-github-api-version': '2022-11-28',
				'user-agent': '@novastarter/auth-driver-github',
				authorization: `Bearer ${ACCESS_TOKEN}`,
			});

			expect(Object.keys(init.headers)).not.toContain('accesstoken');
		});

		test('Requests as the app with Basic credentials and the client id put in, the params as the JSON body', async () => {
			const fetch = answer(200, { id: 7, token: 'gho_checked' });
			const driver = new AuthDriverGithub({ ...credentials, fetch });

			await driver.call('POST /applications/{client_id}/token', { access_token: 'gho_checked' });

			const [url, init] = fetch.mock.calls[0]!;

			expect(url).toBe('https://api.github.com/applications/client-1/token');
			expect(init.method).toBe('POST');
			expect(init.headers['authorization']).toBe(`Basic ${btoa('client-1:secret-of-the-app')}`);
			expect(init.headers['content-type']).toBe('application/json');
			expect(JSON.parse(init.body as string)).toStrictEqual({ access_token: 'gho_checked' });
		});

		test('Fills a placeholder from the params, encoded, and does not send that param again', async () => {
			const fetch = answer(200, []);
			const driver = new AuthDriverGithub({ ...credentials, fetch });

			await driver.call(
				'GET /repos/{owner}/{repo}/issues',
				{ owner: 'acme', repo: 'web/app', state: 'open' },
				{ accessToken: ACCESS_TOKEN },
			);

			// A `/` in a param must not reshape the path
			expect(fetch.mock.calls[0]![0]).toBe('https://api.github.com/repos/acme/web%2Fapp/issues?state=open');
		});

		test('Keeps {client_id} the one of the app, a client_id param sent as a param', async () => {
			const fetch = answer(200, {});
			const driver = new AuthDriverGithub({ ...credentials, fetch });

			await driver.call('POST /applications/{client_id}/token', { client_id: 'other', access_token: 'gho_x' });

			// The Basic credentials are this app's, so the path names this app
			const [url, init] = fetch.mock.calls[0]!;

			expect(url).toBe('https://api.github.com/applications/client-1/token');
			expect(JSON.parse(init.body as string)).toStrictEqual({ client_id: 'other', access_token: 'gho_x' });
		});

		test('Refuses a placeholder nobody filled before any request', async () => {
			const fetch = answer(200, {});
			const driver = new AuthDriverGithub({ ...credentials, fetch });

			// Sent, `{repo}` would reach GitHub as `%7Brepo%7D`
			await expect(driver.call('GET /repos/{owner}/{repo}', { owner: 'acme' })).rejects.toThrow(
				'needs a "repo" parameter',
			);

			expect(fetch).not.toHaveBeenCalled();
		});

		test('Answers with the status, the headers lower-cased and the body', async () => {
			const fetch = answer(200, [{ id: 1 }], { Link: '<https://api.github.com/user/repos?page=2>; rel="next"' });
			const driver = new AuthDriverGithub({ ...credentials, fetch });

			const result = await driver.call('GET /user/repos', {}, { accessToken: ACCESS_TOKEN });

			expect(result).toStrictEqual({
				status: 200,
				headers: {
					'content-type': 'text/plain;charset=UTF-8',
					link: '<https://api.github.com/user/repos?page=2>; rel="next"',
				},
				data: [{ id: 1 }],
			});
		});

		test('Answers nothing for a 204 and accepts a full URL on the upload host', async () => {
			const fetch = answer(204);
			const driver = new AuthDriverGithub({ ...credentials, fetch });

			await expect(
				driver.call('DELETE https://uploads.github.com/repos/o/r/releases/assets/1', {}, { accessToken: ACCESS_TOKEN }),
			).resolves.toMatchObject({ status: 204, data: undefined });

			expect(fetch.mock.calls[0]![0]).toBe('https://uploads.github.com/repos/o/r/releases/assets/1');
		});

		test('Refuses a full URL on another host and a malformed method before any request', async () => {
			const fetch = answer(200, {});
			const driver = new AuthDriverGithub({ ...credentials, fetch });

			// The credentials would go to someone else, so nothing is sent
			await expect(driver.call('GET https://evil.example/user', {}, { accessToken: ACCESS_TOKEN })).rejects.toThrow(
				/the call URL is not on a host of this provider: evil\.example/i,
			);

			await expect(driver.call('FETCH /user')).rejects.toThrow('is not');
			expect(fetch).not.toHaveBeenCalled();
		});

		test('Turns an error status into a ProviderCallError without a credential in its message', async () => {
			const driver = new AuthDriverGithub({ ...credentials, fetch: answer(404, { message: 'Not Found' }) });

			const error = (await driver
				.call('GET /repos/o/private', {}, { accessToken: ACCESS_TOKEN })
				.catch((thrown: unknown) => thrown)) as InstanceType<typeof ProviderCallError>;

			expect(error).toBeInstanceOf(ProviderCallError);
			expect(error.message).toBe('github refused GET /repos/o/private: 404 Not Found');

			expect(error.extensions).toStrictEqual({
				provider: 'github',
				method: 'GET /repos/o/private',
				status: 404,
				body: { message: 'Not Found' },
			});

			const appDriver = new AuthDriverGithub({ ...credentials, fetch: answer(401, { message: 'Bad credentials' }) });

			const appError = (await appDriver
				.call('GET /applications/{client_id}/grant')
				.catch((thrown: unknown) => thrown)) as Error;

			for (const secret of [ACCESS_TOKEN, credentials.clientSecret, btoa('client-1:secret-of-the-app')]) {
				expect(JSON.stringify({ ...error, message: error.message })).not.toContain(secret);
				expect(JSON.stringify({ ...appError, message: appError.message })).not.toContain(secret);
			}
		});

		test('Turns a 429 into a HitRateLimitError reset at Retry-After', async () => {
			const fetch = answer(429, { message: 'API rate limit exceeded' }, { 'retry-after': '60' });
			const driver = new AuthDriverGithub({ ...credentials, fetch });

			const before = Date.now();

			const error = (await driver
				.call('GET /user', {}, { accessToken: ACCESS_TOKEN })
				.catch((thrown: unknown) => thrown)) as InstanceType<typeof HitRateLimitError>;

			expect(error).toBeInstanceOf(HitRateLimitError);
			expect(error.extensions.reset.getTime()).toBeGreaterThanOrEqual(before + 60_000);
		});

		test('Turns a 403 with the primary limit spent into a HitRateLimitError reset at its reset', async () => {
			const reset = Math.floor(Date.now() / 1000) + 300;

			const fetch = answer(
				403,
				{ message: 'API rate limit exceeded for user ID 1.' },
				{ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
			);

			const driver = new AuthDriverGithub({ ...credentials, fetch });

			const error = (await driver
				.call('GET /user', {}, { accessToken: ACCESS_TOKEN })
				.catch((thrown: unknown) => thrown)) as InstanceType<typeof HitRateLimitError>;

			expect(error).toBeInstanceOf(HitRateLimitError);
			expect(Math.round(error.extensions.reset.getTime() / 1000)).toBe(reset);

			const denied = new AuthDriverGithub({ ...credentials, fetch: answer(403, { message: 'Forbidden' }) });

			await expect(denied.call('GET /user', {}, { accessToken: ACCESS_TOKEN })).rejects.toBeInstanceOf(
				ProviderCallError,
			);
		});

		test('Turns a 403 of a secondary limit into a HitRateLimitError reset at Retry-After', async () => {
			const fetch = answer(403, { message: 'You have exceeded a secondary rate limit' }, { 'retry-after': '90' });
			const driver = new AuthDriverGithub({ ...credentials, fetch });

			const before = Date.now();

			const error = (await driver
				.call('GET /user', {}, { accessToken: ACCESS_TOKEN })
				.catch((thrown: unknown) => thrown)) as InstanceType<typeof HitRateLimitError>;

			expect(error).toBeInstanceOf(HitRateLimitError);
			expect(error.extensions.reset.getTime()).toBeGreaterThanOrEqual(before + 90_000);
		});

		test('Takes the caller headers over its own, and the caller timeout over the location one', async () => {
			// A fetch that never answers until aborted, so only the deadline can end it
			const fetch = vi.fn<AuthFetch>(
				(_url, init) =>
					new Promise((_resolve, reject) => {
						init.signal.addEventListener('abort', () => reject(init.signal.reason));
					}),
			);

			const driver = new AuthDriverGithub({ ...credentials, fetch, timeout: 60_000 });

			await expect(
				driver.call('GET /user', {}, { accessToken: ACCESS_TOKEN, timeout: 5, headers: { Accept: 'text/plain' } }),
			).rejects.toBeInstanceOf(TimeoutError);

			expect(fetch.mock.calls[0]![1].headers['accept']).toBe('text/plain');
		});
	});
});
