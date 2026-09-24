/**
 * Tests of the Google driver class on an injected fetch and a local key set: the consent URL, a whole callback from
 * code to identity and tokens, the checks that refuse a callback, the configuration it refuses, `verify()` and
 * `call()`. The URL builder, the exchange, the token verification and the claim mapping have their own tests next to
 * their modules.
 */
import { AuthProviderFailedError } from '@novastarter/auth';
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import { createLocalJWKSet, type CryptoKey, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as entry from '../index.js';
import { JWKS_URL, TOKEN_URL } from './constants.js';
import { AuthDriverGoogle } from './driver.js';
import type { AuthFetch } from './request.js';

/**
 * The key Google would sign with, the local set holding its public half, and that public half alone — what a fake
 * publishes at the key set's URL.
 */
let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;
let publicJwk: JWK;

beforeAll(async () => {
	// 1. One RS256 pair for the whole file: generating keys is the slow part
	const pair = await generateKeyPair('RS256');

	privateKey = pair.privateKey;
	publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
	jwks = createLocalJWKSet({ keys: [publicJwk] });
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
 * A fetch that answers every request with one real `Response`, for `call()`, which reads the headers too.
 *
 * @param status - The HTTP status.
 * @param body - The body, as JSON; `undefined` for none.
 * @param headers - The response headers.
 * @returns The fake fetch, a spy.
 */
const respond = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
	vi.fn<AuthFetch>(async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers }));

/**
 * The client's credentials of every `call()` test; the secret must never show up in an error.
 */
const credentials = { clientId: 'client-1', clientSecret: 'secret-of-the-client' };

/**
 * A person's access token; it must never show up in an error either.
 */
const ACCESS_TOKEN = 'ya29.person-access-token';

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
		expect(entry.AuthDriverGoogle).toBe(AuthDriverGoogle);
	});

	test('Exchanges the code and answers the identity of the verified ID token, with the tokens', async () => {
		const fetch = answer(200, {
			access_token: 'at',
			refresh_token: 'rt',
			scope: 'openid email',
			token_type: 'Bearer',
			id_token: await idToken('nonce-1'),
		});

		const driver = new AuthDriverGoogle({ clientId: 'client-1', clientSecret: 'secret-1', fetch, jwks });

		// 1. The whole callback: one request to the token endpoint, the rest is read from the signed token; the access
		//    and refresh tokens come back beside the identity for `finishOAuth()` to hand on
		expect(await driver.callback(callbackParams)).toMatchObject({
			provider: 'google',
			subject: '1234567890',
			email: 'ada@example.com',
			emailVerified: true,
			name: 'Ada',
			avatarUrl: 'https://p.test/a',
			tokens: { accessToken: 'at', refreshToken: 'rt', scope: ['openid', 'email'], tokenType: 'Bearer' },
		});

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]![0]).toBe(TOKEN_URL);
		expect(new URLSearchParams(fetch.mock.calls[0]![1].body as string).get('code_verifier')).toBe('verifier-1');
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

	test('Reads the key set of a callback through the injected fetch, redirect and all', async () => {
		// 1. No local key set is handed in, so the callback must fetch Google's — over the injected fetch, or a location
		//    behind an egress proxy would read it around the fetch it configured
		const fetch = vi.fn<AuthFetch>(async (url) => {
			if (url === TOKEN_URL) {
				return {
					status: 200,
					ok: true,
					text: async () => JSON.stringify({ access_token: 'at', id_token: await idToken('nonce-1') }),
				};
			}

			if (url === JWKS_URL) {
				return { status: 200, ok: true, text: async () => JSON.stringify({ keys: [publicJwk] }) };
			}

			return { status: 599, ok: false, text: async () => '' };
		});

		const driver = new AuthDriverGoogle({ clientId: 'client-1', clientSecret: 'secret-1', fetch });

		await expect(driver.callback(callbackParams)).resolves.toMatchObject({
			subject: '1234567890',
			email: 'ada@example.com',
		});

		// 2. The key set came from the injected fetch, asked to keep redirects manual so nothing is followed
		const jwksCall = fetch.mock.calls.find(([url]) => url === JWKS_URL);

		expect(jwksCall).toBeDefined();
		expect((jwksCall![1] as { redirect?: string }).redirect).toBe('manual');
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

	describe('call', () => {
		test('Requests an API as the person with their Bearer token, the params as the query', async () => {
			const fetch = respond(200, { items: [{ id: 'primary' }] });
			const driver = new AuthDriverGoogle({ ...credentials, fetch, jwks });

			const { data: list } = await driver.call(
				'GET /calendar/v3/users/me/calendarList',
				{ maxResults: 50 },
				{
					accessToken: ACCESS_TOKEN,
				},
			);

			// 1. The parsed answer, from the API root, with the token and no body
			expect(list).toStrictEqual({ items: [{ id: 'primary' }] });

			const [url, init] = fetch.mock.calls[0]!;

			expect(url).toBe('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50');
			expect(init.method).toBe('GET');
			expect(init.body).toBeUndefined();
			expect(init.headers['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
			expect(Object.keys(init.headers)).not.toContain('accesstoken');
		});

		test('Sends no Authorization without a token, and the params of a POST as the JSON body', async () => {
			const fetch = respond(200, { id: 'e1' });
			const driver = new AuthDriverGoogle({ ...credentials, fetch, jwks });

			// 1. A full URL on another googleapis.com host is Google's own
			await driver.call('POST https://people.googleapis.com/v1/people:searchContacts', { query: 'Ada' });

			const [url, init] = fetch.mock.calls[0]!;

			expect(url).toBe('https://people.googleapis.com/v1/people:searchContacts');
			expect(init.headers).not.toHaveProperty('authorization');
			expect(init.headers['content-type']).toBe('application/json');
			expect(JSON.parse(init.body as string)).toStrictEqual({ query: 'Ada' });
		});

		test('Fills a placeholder from the params, encoded, and does not send that param again', async () => {
			const fetch = respond(200, { items: [] });
			const driver = new AuthDriverGoogle({ ...credentials, fetch, jwks });

			await driver.call(
				'GET /calendar/v3/calendars/{calendarId}/events',
				{ calendarId: 'team@group.calendar.google.com', maxResults: 10 },
				{ accessToken: ACCESS_TOKEN },
			);

			// 1. `{calendarId}` takes its param, encoded, and only `maxResults` is left for the query
			const url = new URL(fetch.mock.calls[0]![0]);

			expect(url.pathname).toBe('/calendar/v3/calendars/team%40group.calendar.google.com/events');
			expect(url.search).toBe('?maxResults=10');
		});

		test('Refuses a placeholder nobody filled before any request', async () => {
			const fetch = respond(200, {});
			const driver = new AuthDriverGoogle({ ...credentials, fetch, jwks });

			// 1. Sent, `{calendarId}` would reach Google as `%7BcalendarId%7D`
			await expect(driver.call('GET /calendar/v3/calendars/{calendarId}/events')).rejects.toThrow(
				'needs a "calendarId" parameter',
			);

			expect(fetch).not.toHaveBeenCalled();
		});

		test('Answers with the status, the headers lower-cased and the body', async () => {
			const fetch = respond(200, { items: [] }, { 'Content-Type': 'application/json', ETag: '"p1"' });
			const driver = new AuthDriverGoogle({ ...credentials, fetch, jwks });

			const result = await driver.call('GET /calendar/v3/users/me/calendarList');

			// 1. Header names come lower-cased
			expect(result).toStrictEqual({
				status: 200,
				headers: { 'content-type': 'application/json', etag: '"p1"' },
				data: { items: [] },
			});
		});

		test('Answers nothing for a 204', async () => {
			const driver = new AuthDriverGoogle({ ...credentials, fetch: respond(204), jwks });

			// 1. An empty answer is `undefined`
			await expect(
				driver.call('DELETE /calendar/v3/calendars/c1/events/e1', {}, { accessToken: ACCESS_TOKEN }),
			).resolves.toMatchObject({ status: 204, data: undefined });
		});

		test('Refuses a full URL off googleapis.com and a malformed method before any request', async () => {
			const fetch = respond(200, {});
			const driver = new AuthDriverGoogle({ ...credentials, fetch, jwks });

			// 1. A look-alike host and a plain foreign one; the token would go to someone else, so nothing is sent
			for (const target of ['https://googleapis.com.evil.example/x', 'https://evil.example/googleapis.com']) {
				await expect(driver.call(`GET ${target}`, {}, { accessToken: ACCESS_TOKEN })).rejects.toThrow(
					'The call URL is not on a host of this provider',
				);
			}

			await expect(driver.call('calendar/v3')).rejects.toThrow('is not');
			expect(fetch).not.toHaveBeenCalled();
		});

		test('Turns an error status into a ProviderCallError without the token in its message', async () => {
			const body = { error: { code: 403, message: 'Request had insufficient authentication scopes.' } };
			const driver = new AuthDriverGoogle({ ...credentials, fetch: respond(403, body), jwks });

			// 1. Google's status and answer are kept for the caller; the message names the method and the reason only
			const error = (await driver
				.call('GET /drive/v3/files', {}, { accessToken: ACCESS_TOKEN })
				.catch((thrown: unknown) => thrown)) as InstanceType<typeof ProviderCallError>;

			expect(error).toBeInstanceOf(ProviderCallError);

			expect(error.message).toBe(
				'google refused GET /drive/v3/files: 403 Request had insufficient authentication scopes.',
			);

			expect(error.extensions).toStrictEqual({ provider: 'google', method: 'GET /drive/v3/files', status: 403, body });

			for (const secret of [ACCESS_TOKEN, credentials.clientSecret]) {
				expect(JSON.stringify({ ...error, message: error.message })).not.toContain(secret);
			}
		});

		test('Turns a 429 into a HitRateLimitError reset at Retry-After', async () => {
			const fetch = respond(429, { error: { message: 'Quota exceeded' } }, { 'retry-after': '30' });
			const driver = new AuthDriverGoogle({ ...credentials, fetch, jwks });

			// 1. The wait Google names is when the limit resets
			const before = Date.now();

			const error = (await driver
				.call('GET /drive/v3/files', {}, { accessToken: ACCESS_TOKEN })
				.catch((thrown: unknown) => thrown)) as InstanceType<typeof HitRateLimitError>;

			expect(error).toBeInstanceOf(HitRateLimitError);
			expect(error.extensions.reset.getTime()).toBeGreaterThanOrEqual(before + 30_000);
		});

		test('Takes the caller headers over its own, and the caller timeout over the location one', async () => {
			// 1. A fetch that never answers until aborted, so only the deadline can end it
			const fetch = vi.fn<AuthFetch>(
				(_url, init) =>
					new Promise((_resolve, reject) => {
						init.signal.addEventListener('abort', () => reject(init.signal.reason));
					}),
			);

			const driver = new AuthDriverGoogle({ ...credentials, fetch, jwks, timeout: 60_000 });

			await expect(
				driver.call(
					'GET /drive/v3/about',
					{},
					{ accessToken: ACCESS_TOKEN, timeout: 5, headers: { 'X-Goog-User-Project': 'p1' } },
				),
			).rejects.toBeInstanceOf(TimeoutError);

			expect(fetch.mock.calls[0]![1].headers['x-goog-user-project']).toBe('p1');
		});
	});
});
