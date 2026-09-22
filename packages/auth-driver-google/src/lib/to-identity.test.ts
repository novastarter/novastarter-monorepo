/**
 * Tests of `to-identity`: how the claims of a Google ID token map to an `AuthIdentity`.
 */
import { describe, expect, test } from 'vitest';
import { toIdentity } from './to-identity.js';

describe('toIdentity', () => {
	test('Maps the subject, the address, its verification, the name and the picture', () => {
		const claims = {
			sub: '1234567890',
			email: 'ada@example.com',
			email_verified: true,
			name: 'Ada Lovelace',
			picture: 'https://lh3.googleusercontent.com/a/1',
		};

		// 1. The claims themselves travel as `raw`, for fields the identity does not carry
		expect(toIdentity(claims)).toStrictEqual({
			provider: 'google',
			subject: '1234567890',
			email: 'ada@example.com',
			emailVerified: true,
			name: 'Ada Lovelace',
			avatarUrl: 'https://lh3.googleusercontent.com/a/1',
			raw: claims,
		});
	});

	test('Counts only true or "true" as verified', () => {
		// 1. Anything else — false, absent, a malformed value — must not be used to link accounts
		expect(toIdentity({ sub: '1', email: 'a@b.c', email_verified: 'true' }).emailVerified).toBe(true);
		expect(toIdentity({ sub: '1', email: 'a@b.c', email_verified: false }).emailVerified).toBe(false);
		expect(toIdentity({ sub: '1', email: 'a@b.c' }).emailVerified).toBe(false);
		expect(toIdentity({ sub: '1', email: 'a@b.c', email_verified: 1 }).emailVerified).toBe(false);
	});

	test('Leaves out what the scopes did not grant or what is malformed', () => {
		// 1. No `email` or `profile` scope: the subject alone; a non-string claim is dropped, not trusted
		expect(toIdentity({ sub: '1', name: 42, picture: '' })).toStrictEqual({
			provider: 'google',
			subject: '1',
			raw: { sub: '1', name: 42, picture: '' },
		});
	});
});
