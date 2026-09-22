/**
 * Integration tests of `auth/refresh-tokens` on PGlite in memory, migrated with the app's `drizzle/` folder. No
 * service is needed, so the suite always runs.
 */
import { hashToken, verifyAccessToken } from '@novastarter/auth';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { useDb } from '../db';
import { authRefreshTokens } from '../db/schema';
import { issueTokens, refreshTokens, revokeAllRefreshTokens, revokeRefreshToken } from './refresh-tokens';
import { bootTestDatabase, clearAuthTables, closeTestDatabase } from './test-database';

/**
 * The error every refusal of a token comes as.
 */
const INVALID = { code: 'AUTH_INVALID_TOKEN' };

/**
 * The stored row of a refresh token.
 *
 * @param token - The refresh token as the client holds it.
 * @returns The row; `undefined` when it is not stored.
 */
const rowOf = async (token: string) => {
	// 1. By the token's hash, the way the module looks it up
	const [row] = await useDb()
		.select()
		.from(authRefreshTokens)
		.where(eq(authRefreshTokens.id, hashToken(token)));

	return row;
};

describe('auth refresh tokens on PGlite', { timeout: 30_000 }, () => {
	beforeAll(bootTestDatabase, 60_000);

	afterAll(closeTestDatabase);

	afterEach(async () => {
		vi.useRealTimers();
		await clearAuthTables();
	});

	test('Issues a pair whose access token verifies and whose refresh token is stored by its hash', async () => {
		const pair = await issueTokens('1', { role: 'admin' });

		// 1. The access token carries the user and the claims
		await expect(verifyAccessToken(pair.accessToken)).resolves.toMatchObject({
			userId: '1',
			claims: { role: 'admin' },
		});

		// 2. The refresh token is stored by its hash, unused
		expect(await rowOf(pair.refreshToken)).toMatchObject({ userId: '1', usedAt: null });
		expect(pair.refreshExpiresAt).toBe((await rowOf(pair.refreshToken))?.expiresAt.getTime());
	});

	test('Rotates within the family and marks the old token used', async () => {
		const first = await issueTokens('1');
		const { userId, pair } = await refreshTokens(first.refreshToken, { role: 'editor' });

		// 1. A new pair for the same user, with the fresh claims
		expect(userId).toBe('1');
		await expect(verifyAccessToken(pair.accessToken)).resolves.toMatchObject({ claims: { role: 'editor' } });

		// 2. The old token is kept, used; the successor shares its family
		const old = await rowOf(first.refreshToken);
		const next = await rowOf(pair.refreshToken);

		expect(old?.usedAt).toBeInstanceOf(Date);
		expect(next).toMatchObject({ familyId: old?.familyId, usedAt: null });
	});

	test('Revokes the family when a used token is presented again', async () => {
		const first = await issueTokens('1');
		const other = await issueTokens('1');
		const { pair } = await refreshTokens(first.refreshToken);

		// 1. The replay is refused, and the successor the client holds dies with the family
		await expect(refreshTokens(first.refreshToken)).rejects.toMatchObject(INVALID);
		await expect(refreshTokens(pair.refreshToken)).rejects.toMatchObject(INVALID);
		expect(await rowOf(first.refreshToken)).toBeUndefined();

		// 2. Another sign-in's family is untouched
		await expect(refreshTokens(other.refreshToken)).resolves.toMatchObject({ userId: '1' });
	});

	test('Lets exactly one of two concurrent refreshes win, and revokes the family for the replay', async () => {
		const first = await issueTokens('1');

		// 1. The conditional mark decides: one rotation succeeds, the other is a replay
		const outcomes = await Promise.allSettled([refreshTokens(first.refreshToken), refreshTokens(first.refreshToken)]);
		const won = outcomes.filter((outcome) => outcome.status === 'fulfilled');

		expect(won).toHaveLength(1);
		expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);

		// 2. The replay took the whole family down, the winner's successor included
		const winner = won[0];

		if (winner?.status !== 'fulfilled') {
			throw new Error('one refresh must have won');
		}

		await expect(refreshTokens(winner.value.pair.refreshToken)).rejects.toMatchObject(INVALID);
		expect(await useDb().select().from(authRefreshTokens)).toHaveLength(0);
	});

	test('Refuses an unknown and an expired token', async () => {
		await expect(refreshTokens('unknown')).rejects.toMatchObject(INVALID);

		// 1. Past its deadline the token refreshes nothing
		vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 0, 1) });

		const pair = await issueTokens('1');

		vi.setSystemTime(pair.refreshExpiresAt);
		await expect(refreshTokens(pair.refreshToken)).rejects.toMatchObject(INVALID);
	});

	test('Revokes the family of one token', async () => {
		const first = await issueTokens('1');
		const { pair } = await refreshTokens(first.refreshToken);
		const other = await issueTokens('1');

		// 1. Signing out with the latest token takes its whole chain
		await revokeRefreshToken(pair.refreshToken);
		expect(await rowOf(first.refreshToken)).toBeUndefined();
		expect(await rowOf(pair.refreshToken)).toBeUndefined();

		// 2. Another family stays, and an unknown token is a no-op
		await revokeRefreshToken('unknown');
		expect(await rowOf(other.refreshToken)).toBeDefined();
	});

	test('Revokes every refresh token of a user', async () => {
		const first = await issueTokens('1');

		await refreshTokens(first.refreshToken);
		await issueTokens('1');

		const stranger = await issueTokens('2');

		// 1. Used and unused, every family of the user
		expect(await revokeAllRefreshTokens('1')).toBe(3);
		expect(await rowOf(stranger.refreshToken)).toBeDefined();
	});
});
