/**
 * Tests of `auth/tokens/jwt/verify-access-token` against tokens `issueTokenPair()` signs.
 */
import { exportPKCS8, exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuthSettings } from '../../lib/settings.js';
import { useAuth } from '../../lib/use-auth.js';
import { ACCESS_TOKEN_TYPE, issueTokenPair } from './issue-token-pair.js';
import { verifyAccessToken } from './verify-access-token.js';

/**
 * The frozen clock the tests start at.
 */
const NOW = Date.UTC(2026, 0, 1);

/**
 * An HMAC secret long enough to be accepted.
 */
const SECRET = 'test-jwt-secret-of-at-least-32-characters';

/**
 * The error every refusal of a token comes as.
 */
const INVALID = { code: 'AUTH_INVALID_TOKEN' };

/**
 * Register the given settings.
 *
 * @param settings - The auth settings of the test.
 */
const setup = (settings: AuthSettings): void => {
	// The settings are all the signing reads; nothing is stored, so nothing else needs setting up
	useAuth().registerSettings(settings);
};

/**
 * Make a PEM ES256 key pair, as an application would keep it in its secrets.
 *
 * @returns The PKCS#8 private and SPKI public PEM.
 */
const es256Pair = async (): Promise<{ privateKey: string; publicKey: string }> => {
	// Extractable, since the settings take the keys as PEM text
	const pair = await generateKeyPair('ES256', { extractable: true });

	return { privateKey: await exportPKCS8(pair.privateKey), publicKey: await exportSPKI(pair.publicKey) };
};

/**
 * Encode a value as base64url JSON, one part of a hand-made JWT.
 *
 * @param value - The header or the payload.
 * @returns The encoded part.
 */
const part = (value: unknown): string => {
	// What jose would write, without jose, so a token it would never sign can be built
	return Buffer.from(JSON.stringify(value)).toString('base64url');
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	useAuth.reset();
});

describe('verifyAccessToken', () => {
	test('Accepts an HS256 token it issued and returns the user and every claim', async () => {
		setup({ jwt: { secret: SECRET, issuer: 'https://auth.example', audience: 'api' } });

		const {
			pair: { accessToken },
		} = await issueTokenPair('user-1', { claims: { role: 'admin' } });

		const verified = await verifyAccessToken(accessToken);

		expect(verified.userId).toBe('user-1');
		expect(verified.claims).toMatchObject({ sub: 'user-1', role: 'admin', iss: 'https://auth.example', aud: 'api' });
	});

	test('Accepts an ES256 token it issued', async () => {
		setup({ jwt: { algorithm: 'ES256', ...(await es256Pair()) } });

		const {
			pair: { accessToken },
		} = await issueTokenPair('user-1');

		expect((await verifyAccessToken(accessToken)).userId).toBe('user-1');
	});

	test('Refuses a token signed with another ES256 key', async () => {
		setup({ jwt: { algorithm: 'ES256', ...(await es256Pair()) } });

		const {
			pair: { accessToken },
		} = await issueTokenPair('user-1');

		useAuth().registerSettings({ jwt: { algorithm: 'ES256', ...(await es256Pair()) } });

		await expect(verifyAccessToken(accessToken)).rejects.toMatchObject(INVALID);
	});

	test('Refuses a tampered token, with the reason as the cause', async () => {
		setup({ jwt: { secret: SECRET } });

		const {
			pair: { accessToken },
		} = await issueTokenPair('user-1');

		const [header, , signature] = accessToken.split('.');
		const forged = [header, part({ sub: 'admin', exp: NOW / 1000 + 900 }), signature].join('.');

		const failure = verifyAccessToken(forged);

		await expect(failure).rejects.toMatchObject(INVALID);
		await expect(failure).rejects.toHaveProperty('cause.code', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED');
	});

	test('Refuses an expired token', async () => {
		setup({ jwt: { secret: SECRET, accessTtl: 60_000 } });

		const {
			pair: { accessToken },
		} = await issueTokenPair('user-1');

		vi.setSystemTime(NOW + 61_000);

		await expect(verifyAccessToken(accessToken)).rejects.toMatchObject(INVALID);
	});

	test('Refuses a token of another issuer or audience', async () => {
		setup({ jwt: { secret: SECRET, issuer: 'https://auth.example', audience: 'api' } });

		const {
			pair: { accessToken },
		} = await issueTokenPair('user-1');

		useAuth().registerSettings({ jwt: { secret: SECRET, issuer: 'https://other.example', audience: 'api' } });
		await expect(verifyAccessToken(accessToken)).rejects.toMatchObject(INVALID);

		useAuth().registerSettings({ jwt: { secret: SECRET, issuer: 'https://auth.example', audience: 'admin' } });
		await expect(verifyAccessToken(accessToken)).rejects.toMatchObject(INVALID);
	});

	test('Refuses an unsigned token claiming alg none', async () => {
		setup({ jwt: { secret: SECRET } });

		// A token with an empty signature must never be taken at its word
		const unsigned = `${part({ alg: 'none', typ: ACCESS_TOKEN_TYPE })}.${part({ sub: 'user-1', exp: NOW / 1000 + 900 })}.`;

		await expect(verifyAccessToken(unsigned)).rejects.toMatchObject(INVALID);
	});

	test('Refuses a token signed with another algorithm than the configured one', async () => {
		const pair = await es256Pair();

		setup({ jwt: { algorithm: 'ES256', ...pair } });

		// HMAC keyed with the public PEM — the classic algorithm confusion — is refused by the pinned algorithm
		const confused = await new SignJWT({})
			.setProtectedHeader({ alg: 'HS256', typ: ACCESS_TOKEN_TYPE })
			.setSubject('user-1')
			.setExpirationTime(NOW / 1000 + 900)
			.sign(new TextEncoder().encode(pair.publicKey));

		await expect(verifyAccessToken(confused)).rejects.toMatchObject(INVALID);
	});

	test('Refuses a JWT of another type signed with the same key', async () => {
		setup({ jwt: { secret: SECRET } });

		const idToken = await new SignJWT({})
			.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
			.setSubject('user-1')
			.setExpirationTime(NOW / 1000 + 900)
			.sign(new TextEncoder().encode(SECRET));

		await expect(verifyAccessToken(idToken)).rejects.toMatchObject(INVALID);
	});

	test('Refuses a token without a subject', async () => {
		setup({ jwt: { secret: SECRET } });

		const anonymous = await new SignJWT({})
			.setProtectedHeader({ alg: 'HS256', typ: ACCESS_TOKEN_TYPE })
			.setExpirationTime(NOW / 1000 + 900)
			.sign(new TextEncoder().encode(SECRET));

		await expect(verifyAccessToken(anonymous)).rejects.toMatchObject(INVALID);
	});

	test('Refuses garbage', async () => {
		setup({ jwt: { secret: SECRET } });

		await expect(verifyAccessToken('not-a-jwt')).rejects.toMatchObject(INVALID);
		await expect(verifyAccessToken('')).rejects.toMatchObject(INVALID);
	});

	test('Throws the configuration error itself when the jwt settings are missing', async () => {
		setup({});

		// Not hidden behind an invalid token: the operator has to see it
		await expect(verifyAccessToken('anything')).rejects.toThrow('JWT tokens need the "jwt" auth settings');
	});
});
