/**
 * Tests of the GitHub driver class on an injected fetch: the consent URL, a whole callback from code to identity, a
 * refused code, and the configuration it refuses. The URL builder, the exchange, the profile requests, the address
 * pick and the mapping have their own tests next to their modules.
 */
import { AuthProviderFailedError } from '@novastarter/auth';
import { describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
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
		// 1. An unrouted URL is a test mistake, answered with a 599 so it cannot pass silently
		const route = routes[url] ?? { status: 599, body: undefined };

		return { status: route.status, ok: route.status < 300, text: async () => JSON.stringify(route.body) };
	});

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
		expect(defaultExport).toBe(AuthDriverGithub);
	});

	test('Exchanges the code and answers the identity read from the REST API', async () => {
		const fetch = routed({
			[TOKEN_URL]: { status: 200, body: { access_token: 'gho_1', token_type: 'bearer' } },
			[USER_URL]: { status: 200, body: { id: 583231, login: 'octocat', name: null, avatar_url: 'https://a.test/1' } },
			[EMAILS_URL]: { status: 200, body: [{ email: 'octo@example.com', primary: true, verified: true }] },
		});

		const driver = new AuthDriverGithub({ clientId: 'client-1', clientSecret: 'secret-1', fetch });

		// 1. Three requests: the exchange, then the profile and the addresses with the token it bought
		expect(await driver.callback(callbackParams)).toMatchObject({
			provider: 'github',
			subject: '583231',
			email: 'octo@example.com',
			emailVerified: true,
			name: 'octocat',
			avatarUrl: 'https://a.test/1',
		});

		expect(fetch.mock.calls.map(([url]) => url).sort()).toStrictEqual([EMAILS_URL, TOKEN_URL, USER_URL].sort());
		expect(new URLSearchParams(fetch.mock.calls[0]![1].body).get('code_verifier')).toBe('verifier-1');
	});

	test('Refuses a code GitHub refused, without reading the profile', async () => {
		// 1. The refusal comes as a 200 with an error; no REST request follows it
		const fetch = routed({ [TOKEN_URL]: { status: 200, body: { error: 'bad_verification_code' } } });
		const driver = new AuthDriverGithub({ clientId: 'client-1', clientSecret: 'secret-1', fetch });

		await expect(driver.callback(callbackParams)).rejects.toBeInstanceOf(AuthProviderFailedError);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test('Refuses missing credentials and a timeout a timer cannot hold', () => {
		// 1. Each missing option is named, so the fix is obvious from the message
		expect(() => new AuthDriverGithub({ clientId: '', clientSecret: 'secret-1' })).toThrow(
			'The github auth driver needs a "clientId"',
		);

		expect(() => new AuthDriverGithub({ clientId: 'client-1', clientSecret: '' })).toThrow(
			'The github auth driver needs a "clientSecret"',
		);

		// 2. Zero, fractions and values past the timer's bound would fail every request; they are refused up front
		for (const timeout of [0, 1.5, 2 ** 31, Number.NaN]) {
			expect(() => new AuthDriverGithub({ clientId: 'client-1', clientSecret: 'secret-1', timeout })).toThrow(
				RangeError,
			);
		}
	});
});
