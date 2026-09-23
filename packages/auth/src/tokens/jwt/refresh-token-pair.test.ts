/**
 * Tests of `auth/tokens/jwt/refresh-token-pair`.
 *
 * Storage is a map of records, with the conditional mark and the family delete an application would run.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuth } from '../../lib/use-auth.js';
import type { RefreshRecord } from '../../types.js';
import { hashToken } from '../../utils/index.js';
import { issueTokenPair } from './issue-token-pair.js';
import { refreshTokenPair, type RefreshTokenPairOptions } from './refresh-token-pair.js';
import { verifyAccessToken } from './verify-access-token.js';

/**
 * The frozen clock every test starts at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * A JWT secret long enough to be accepted.
 */
const SECRET = 'test-jwt-secret-of-at-least-32-characters';

/**
 * The error every refused token comes as.
 */
const INVALID = { code: 'AUTH_INVALID_TOKEN' };

/**
 * Storage the way an application keeps refresh tokens, with the three callbacks of {@link refreshTokenPair}.
 *
 * @returns The map and the storage callbacks.
 */
const storage = (): { records: Map<string, RefreshRecord> } & Omit<RefreshTokenPairOptions, 'token' | 'claims'> => {
	const records = new Map<string, RefreshRecord>();

	return {
		records,
		// 1. By the token's hash
		find: async (id) => records.get(id) ?? null,
		// 2. The successor first, then the mark only while the current one is unused
		rotate: async (current, next) => {
			records.set(next.id, next);

			const stored = records.get(current.id);

			if (!stored || stored.usedAt !== null) {
				return false;
			}

			records.set(current.id, { ...stored, usedAt: Date.now() });

			return true;
		},
		// 3. Every token of the family
		revokeFamily: async (familyId) => {
			for (const [id, record] of records) {
				if (record.familyId === familyId) {
					records.delete(id);
				}
			}
		},
	};
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	useAuth().registerSettings({ jwt: { secret: SECRET, refreshTtl: 60_000 } });
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
});

describe('refreshTokenPair', () => {
	test('Refuses an unknown token and an expired one', async () => {
		const store = storage();
		const { pair, refresh } = await issueTokenPair('user-1');

		// 1. Nothing stored under the hash
		await expect(refreshTokenPair({ ...store, token: pair.refreshToken })).rejects.toMatchObject(INVALID);

		// 2. Stored, but at its deadline
		store.records.set(refresh.id, refresh);
		vi.setSystemTime(NOW + 60_000);
		await expect(refreshTokenPair({ ...store, token: pair.refreshToken })).rejects.toMatchObject(INVALID);
	});

	test('Rotates an unused token into the next one of the same family', async () => {
		const store = storage();
		const { pair, refresh } = await issueTokenPair('user-1');

		store.records.set(refresh.id, refresh);
		vi.setSystemTime(NOW + 1_000);

		const refreshed = await refreshTokenPair({ ...store, token: pair.refreshToken, claims: { role: 'admin' } });

		// 1. The presented token is marked used, and its successor is stored in the family
		expect(store.records.get(refresh.id)?.usedAt).toBe(NOW + 1_000);

		expect(store.records.get(hashToken(refreshed.pair.refreshToken))).toStrictEqual({
			id: hashToken(refreshed.pair.refreshToken),
			familyId: refresh.familyId,
			userId: 'user-1',
			createdAt: NOW + 1_000,
			expiresAt: NOW + 61_000,
			usedAt: null,
		});

		// 2. The new access token carries the claims read afresh
		expect(refreshed.userId).toBe('user-1');

		await expect(verifyAccessToken(refreshed.pair.accessToken)).resolves.toMatchObject({
			userId: 'user-1',
			claims: { role: 'admin' },
		});
	});

	test('Revokes the whole family when a used token comes back', async () => {
		const store = storage();
		const { pair, refresh } = await issueTokenPair('user-1');

		store.records.set(refresh.id, refresh);

		const refreshed = await refreshTokenPair({ ...store, token: pair.refreshToken });

		// 1. The first token again: a replay, refused, and the successor the client holds is gone too
		await expect(refreshTokenPair({ ...store, token: pair.refreshToken })).rejects.toMatchObject(INVALID);
		expect(store.records.size).toBe(0);
		await expect(refreshTokenPair({ ...store, token: refreshed.pair.refreshToken })).rejects.toMatchObject(INVALID);
	});

	test('Revokes the family when another request rotated the same token first', async () => {
		const store = storage();
		const { pair, refresh } = await issueTokenPair('user-1');
		const revokeFamily = vi.spyOn(store, 'revokeFamily');

		store.records.set(refresh.id, refresh);

		// 1. The mark moves nothing, as when a concurrent request won the race
		await expect(
			refreshTokenPair({ ...store, token: pair.refreshToken, rotate: async () => false }),
		).rejects.toMatchObject(INVALID);

		expect(revokeFamily).toHaveBeenCalledWith(refresh.familyId);
	});
});
