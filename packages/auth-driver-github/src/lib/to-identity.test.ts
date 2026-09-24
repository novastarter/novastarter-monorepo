/**
 * Tests of `to-identity`: how GitHub's profile and address map to an `AuthIdentity`.
 */
import { describe, expect, test } from 'vitest';
import { toIdentity } from './to-identity.js';

describe('toIdentity', () => {
	test('Maps the numeric id, the verified address, the name and the avatar', () => {
		const user = { id: 583231, login: 'octocat', name: 'The Octocat', avatar_url: 'https://a.test/1' };

		expect(toIdentity({ user, email: 'octo@example.com' })).toStrictEqual({
			provider: 'github',
			subject: '583231',
			email: 'octo@example.com',
			emailVerified: true,
			name: 'The Octocat',
			avatarUrl: 'https://a.test/1',
			raw: user,
		});
	});

	test('Falls back to the login for the name and leaves out what is missing', () => {
		const user = { id: 1, login: 'octocat', name: null, avatar_url: '' };

		expect(toIdentity({ user })).toStrictEqual({ provider: 'github', subject: '1', name: 'octocat', raw: user });
	});
});
