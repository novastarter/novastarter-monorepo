/**
 * Tests of `auth/tokens/jwt/refresh-token-pair`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuth } from '../../lib/use-auth.js';
import type { RefreshRecord } from '../../types.js';
import { hashToken } from '../../utils/index.js';
import { issueTokenPair } from './issue-token-pair.js';
import { refreshTokenPair } from './refresh-token-pair.js';
import { verifyAccessToken } from './verify-access-token.js';

/**
 * The frozen clock every test starts at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * An HMAC secret long enough to be accepted.
 */
const SECRET = 'test-jwt-secret-of-at-least-32-characters';

/**
 * The error every refused refresh comes as.
 */
const INVALID = { code: 'AUTH_INVALID_TOKEN' };

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
	test('Refuses a missing record and an expired one', async () => {
		const { refresh } = await issueTokenPair('user-1');

		// 1. Nothing found by the hash
		await expect(refreshTokenPair(undefined)).rejects.toMatchObject(INVALID);
		await expect(refreshTokenPair(null)).rejects.toMatchObject(INVALID);

		// 2. At its deadline the token refreshes nothing
		vi.setSystemTime(NOW + 60_000);
		await expect(refreshTokenPair(refresh)).rejects.toMatchObject(INVALID);
	});

	test('Reports a used token as reused, with the family to delete', async () => {
		const { refresh } = await issueTokenPair('user-1');
		const used: RefreshRecord = { ...refresh, usedAt: NOW };

		// 1. A replay: no new pair, only the family to revoke
		await expect(refreshTokenPair(used)).resolves.toStrictEqual({
			status: 'reused',
			userId: 'user-1',
			familyId: refresh.familyId,
		});
	});

	test('Rotates an unused token into the next one of the same family', async () => {
		const { refresh } = await issueTokenPair('user-1');

		vi.setSystemTime(NOW + 1_000);

		const outcome = await refreshTokenPair(refresh, { claims: { role: 'admin' } });

		// 1. Only a rotation carries a pair; anything else fails the test right here
		if (outcome.status !== 'rotated') {
			throw new Error(`Expected a rotation, got ${outcome.status}`);
		}

		// 2. The successor stays in the family, under a new id, unused, with a fresh lifetime
		expect(outcome.userId).toBe('user-1');

		expect(outcome.next).toStrictEqual({
			id: hashToken(outcome.pair.refreshToken),
			familyId: refresh.familyId,
			userId: 'user-1',
			createdAt: NOW + 1_000,
			expiresAt: NOW + 61_000,
			usedAt: null,
		});

		expect(outcome.next.id).not.toBe(refresh.id);

		// 3. The new access token checks out and carries the claims read afresh
		await expect(verifyAccessToken(outcome.pair.accessToken)).resolves.toMatchObject({
			userId: 'user-1',
			claims: { role: 'admin' },
		});
	});
});
