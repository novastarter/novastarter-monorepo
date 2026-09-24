/**
 * Tests of `fetch-profile`: the REST requests for the profile and the addresses, and which of their failures fail the
 * sign-in.
 */
import { AuthProviderFailedError } from '@novastarter/auth';
import { HitRateLimitError } from '@novastarter/errors';
import { describe, expect, test, vi } from 'vitest';
import { API_VERSION, EMAILS_URL, USER_AGENT, USER_URL } from './constants.js';
import { fetchProfile } from './fetch-profile.js';
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
 * The profile of every test.
 */
const user = { id: 583231, login: 'octocat', name: 'The Octocat', avatar_url: 'https://a.test/1' };

describe('fetchProfile', () => {
	test('Reads the profile and the primary verified address with the REST headers', async () => {
		const fetch = routed({
			[USER_URL]: { status: 200, body: user },
			[EMAILS_URL]: { status: 200, body: [{ email: 'octo@example.com', primary: true, verified: true }] },
		});

		expect(await fetchProfile({ fetch, timeout: 1_000 }, 'gho_1')).toStrictEqual({ user, email: 'octo@example.com' });

		// GitHub refuses a request without a user agent
		for (const [, init] of fetch.mock.calls) {
			expect(init.headers).toStrictEqual({
				Authorization: 'Bearer gho_1',
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': API_VERSION,
				'User-Agent': USER_AGENT,
			});
		}
	});

	test('Answers no address when the addresses scope was not granted', async () => {
		// Without `user:email` GitHub refuses the list with 403 or 404; the sign-in goes on without an address
		for (const status of [403, 404]) {
			const fetch = routed({
				[USER_URL]: { status: 200, body: user },
				[EMAILS_URL]: { status, body: { message: 'Not Found' } },
			});

			expect(await fetchProfile({ fetch, timeout: 1_000 }, 'gho_1')).toStrictEqual({ user });
		}
	});

	test('Fails on a spent rate limit of the addresses instead of answering no address', async () => {
		// GitHub spends its primary limit with a 403 and `x-ratelimit-remaining: 0`; that is the rate limit it is, not
		// a missing scope, and the error carries GitHub's reset so the caller can retry
		const reset = Math.floor(Date.now() / 1000) + 120;

		const fetch = vi.fn<AuthFetch>(async (url) =>
			url === USER_URL
				? { status: 200, ok: true, text: async () => JSON.stringify(user) }
				: new Response(JSON.stringify({ message: 'API rate limit exceeded for user ID 1.' }), {
						status: 403,
						headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
					}),
		);

		const error = (await fetchProfile({ fetch, timeout: 1_000 }, 'gho_1').catch(
			(thrown: unknown) => thrown,
		)) as InstanceType<typeof HitRateLimitError>;

		expect(error).toBeInstanceOf(HitRateLimitError);
		expect(error.message).toMatch(/^Too many requests, retry after /);
		expect(error.extensions.reset.getTime()).toBeGreaterThanOrEqual(reset * 1000 - 2_000);
		expect(error.extensions.reset.getTime()).toBeLessThanOrEqual(reset * 1000 + 2_000);
	});

	test('Fails on a spent rate limit of the profile as the rate limit, not a provider failure', async () => {
		// Both requests draw on the token's one budget, so a spent limit refuses the profile as well; the profile is
		// checked first, and its refusal must still carry GitHub's reset rather than read as a permanent failure
		const reset = Math.floor(Date.now() / 1000) + 120;

		const fetch = vi.fn<AuthFetch>(
			async () =>
				new Response(JSON.stringify({ message: 'API rate limit exceeded for user ID 1.' }), {
					status: 403,
					headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
				}),
		);

		const error = (await fetchProfile({ fetch, timeout: 1_000 }, 'gho_1').catch(
			(thrown: unknown) => thrown,
		)) as InstanceType<typeof HitRateLimitError>;

		expect(error).toBeInstanceOf(HitRateLimitError);
		expect(error.extensions.reset.getTime()).toBeGreaterThanOrEqual(reset * 1000 - 2_000);
		expect(error.extensions.reset.getTime()).toBeLessThanOrEqual(reset * 1000 + 2_000);
	});

	test('Fails on a refused profile, a profile without an id, and an addresses outage', async () => {
		const refused = routed({
			[USER_URL]: { status: 401, body: { message: 'Bad credentials' } },
			[EMAILS_URL]: { status: 401, body: { message: 'Bad credentials' } },
		});

		const error = await fetchProfile({ fetch: refused, timeout: 1_000 }, 'gho_1').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(AuthProviderFailedError);

		expect(error).toMatchObject({
			message: 'The github sign-in failed: the user endpoint answered 401: Bad credentials',
		});

		// A profile without a numeric id has nothing stable to link by
		const anonymous = routed({
			[USER_URL]: { status: 200, body: { login: 'octocat' } },
			[EMAILS_URL]: { status: 200, body: [] },
		});

		await expect(fetchProfile({ fetch: anonymous, timeout: 1_000 }, 'gho_1')).rejects.toThrow(
			'the user profile carried no id',
		);

		// An outage of the address list must not pass for "no address"
		const outage = routed({ [USER_URL]: { status: 200, body: user }, [EMAILS_URL]: { status: 500, body: undefined } });

		await expect(fetchProfile({ fetch: outage, timeout: 1_000 }, 'gho_1')).rejects.toThrow(
			'the emails endpoint answered 500',
		);
	});
});
