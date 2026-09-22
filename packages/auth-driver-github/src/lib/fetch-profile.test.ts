/**
 * Tests of `fetch-profile`: the REST requests for the profile and the addresses, and which of their failures fail the
 * sign-in.
 */
import { AuthProviderFailedError } from '@novastarter/auth';
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
		// 1. An unrouted URL is a test mistake, answered with a 599 so it cannot pass silently
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

		// 1. Both requests carry the token, the media type, the pinned version and a user agent GitHub insists on
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
		// 1. Without `user:email` GitHub refuses the list with 403 or 404; the sign-in goes on without an address
		for (const status of [403, 404]) {
			const fetch = routed({
				[USER_URL]: { status: 200, body: user },
				[EMAILS_URL]: { status, body: { message: 'Not Found' } },
			});

			expect(await fetchProfile({ fetch, timeout: 1_000 }, 'gho_1')).toStrictEqual({ user });
		}
	});

	test('Fails on a refused profile, a profile without an id, and an addresses outage', async () => {
		// 1. A revoked token: the profile is refused with GitHub's message
		const refused = routed({
			[USER_URL]: { status: 401, body: { message: 'Bad credentials' } },
			[EMAILS_URL]: { status: 401, body: { message: 'Bad credentials' } },
		});

		const error = await fetchProfile({ fetch: refused, timeout: 1_000 }, 'gho_1').catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(AuthProviderFailedError);

		expect(error).toMatchObject({
			message: 'The github sign-in failed: the user endpoint answered 401: Bad credentials',
		});

		// 2. A profile without a numeric id has nothing stable to link by
		const anonymous = routed({
			[USER_URL]: { status: 200, body: { login: 'octocat' } },
			[EMAILS_URL]: { status: 200, body: [] },
		});

		await expect(fetchProfile({ fetch: anonymous, timeout: 1_000 }, 'gho_1')).rejects.toThrow(
			'the user profile carried no id',
		);

		// 3. An outage of the address list must not pass for "no address"
		const outage = routed({ [USER_URL]: { status: 200, body: user }, [EMAILS_URL]: { status: 500, body: undefined } });

		await expect(fetchProfile({ fetch: outage, timeout: 1_000 }, 'gho_1')).rejects.toThrow(
			'the emails endpoint answered 500',
		);
	});
});
