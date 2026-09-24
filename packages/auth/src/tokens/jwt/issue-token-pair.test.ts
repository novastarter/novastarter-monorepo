/**
 * Tests of `auth/tokens/jwt/issue-token-pair`.
 */
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_ACCESS_TOKEN_TTL, DEFAULT_REFRESH_TOKEN_TTL } from '../../lib/settings.js';
import { useAuth } from '../../lib/use-auth.js';
import { hashToken } from '../../utils/index.js';
import { ACCESS_TOKEN_TYPE, issueTokenPair } from './issue-token-pair.js';
import { verifyAccessToken } from './verify-access-token.js';

/**
 * The frozen clock every test runs at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * An HMAC secret long enough to be accepted.
 */
const SECRET = 'test-jwt-secret-of-at-least-32-characters';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
});

describe('issueTokenPair', () => {
	test('Returns the pair and the refresh record to store', async () => {
		useAuth().registerSettings({ jwt: { secret: SECRET } });

		const { pair, refresh } = await issueTokenPair('user-1');

		expect(pair.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(pair.expiresIn).toBe(DEFAULT_ACCESS_TOKEN_TTL / 1000);
		expect(pair.refreshExpiresAt).toBe(NOW + DEFAULT_REFRESH_TOKEN_TTL);

		expect(refresh).toStrictEqual({
			id: hashToken(pair.refreshToken),
			familyId: expect.any(String),
			userId: 'user-1',
			createdAt: NOW,
			expiresAt: NOW + DEFAULT_REFRESH_TOKEN_TTL,
			usedAt: null,
		});
	});

	test('Signs the registered claims, the configured ones and the custom ones', async () => {
		useAuth().registerSettings({
			jwt: { secret: SECRET, issuer: 'https://auth.example', audience: 'api', accessTtl: 60_000 },
		});

		const { pair } = await issueTokenPair('user-1', { claims: { role: 'admin' } });

		expect(decodeProtectedHeader(pair.accessToken)).toStrictEqual({ alg: 'HS256', typ: ACCESS_TOKEN_TYPE });

		expect(decodeJwt(pair.accessToken)).toStrictEqual({
			sub: 'user-1',
			iat: NOW / 1000,
			exp: NOW / 1000 + 60,
			jti: expect.any(String),
			iss: 'https://auth.example',
			aud: 'api',
			role: 'admin',
		});

		expect(pair.expiresIn).toBe(60);

		await expect(verifyAccessToken(pair.accessToken)).resolves.toMatchObject({ userId: 'user-1' });
	});

	test('Drops custom claims under reserved names', async () => {
		useAuth().registerSettings({ jwt: { secret: SECRET } });

		const { pair } = await issueTokenPair('user-1', {
			claims: { sub: 'admin', exp: 9_999_999_999, iss: 'x', aud: 'x', iat: 1, nbf: 1, jti: 'x', role: 'user' },
		});

		const claims = decodeJwt(pair.accessToken);

		expect(claims).toMatchObject({ sub: 'user-1', exp: NOW / 1000 + DEFAULT_ACCESS_TOKEN_TTL / 1000, role: 'user' });
		expect(claims.jti).not.toBe('x');
		expect(claims).not.toHaveProperty('iss');
		expect(claims).not.toHaveProperty('aud');
		expect(claims).not.toHaveProperty('nbf');
	});

	test('Starts a new family, and new tokens, on every call', async () => {
		useAuth().registerSettings({ jwt: { secret: SECRET } });

		const first = await issueTokenPair('user-1');
		const second = await issueTokenPair('user-1');

		expect(first.refresh.familyId).not.toBe(second.refresh.familyId);
		expect(first.pair.refreshToken).not.toBe(second.pair.refreshToken);
		expect(decodeJwt(first.pair.accessToken).jti).not.toBe(decodeJwt(second.pair.accessToken).jti);
	});

	test('Refuses to run without the jwt settings', async () => {
		await expect(issueTokenPair('user-1')).rejects.toThrow('JWT tokens need the "jwt" auth settings');
	});
});
