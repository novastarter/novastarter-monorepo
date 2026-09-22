/**
 * Tests of `auth/tokens/jwt/keys`.
 */
import { type CryptoKey, exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { afterEach, describe, expect, test } from 'vitest';
import type { AuthJwtSettings } from '../../lib/settings.js';
import { useAuth } from '../../lib/use-auth.js';
import { jwtKeys } from './keys.js';

/**
 * An HMAC secret long enough to be accepted.
 */
const SECRET = 'x'.repeat(32);

/**
 * Make a PEM key pair for an algorithm, as an application would keep it in its secrets.
 *
 * @param algorithm - `ES256` or `EdDSA`.
 * @returns The PKCS#8 private and SPKI public PEM.
 */
const pemPair = async (algorithm: 'ES256' | 'EdDSA'): Promise<{ privateKey: string; publicKey: string }> => {
	// 1. Extractable, since the settings take the keys as PEM text
	const pair = await generateKeyPair(algorithm, { extractable: true });

	return { privateKey: await exportPKCS8(pair.privateKey), publicKey: await exportSPKI(pair.publicKey) };
};

afterEach(() => {
	useAuth.reset();
});

describe('jwtKeys', () => {
	test('Refuses to run without the jwt settings', () => {
		// 1. Thrown by name rather than as a failed signature later
		expect(() => jwtKeys()).toThrow('JWT tokens need the "jwt" auth settings');
	});

	test('Uses HS256 with the secret as both keys', async () => {
		useAuth().registerSettings({ jwt: { secret: SECRET } });

		// 1. The algorithm follows from the secret; one key signs and verifies
		const keys = await jwtKeys();

		expect(keys.algorithm).toBe('HS256');
		expect(keys.signKey).toStrictEqual(new TextEncoder().encode(SECRET));
		expect(keys.verifyKey).toBe(keys.signKey);
	});

	test('Refuses an HS256 secret shorter than 32 characters, and a missing one', async () => {
		const message = 'The "jwt.secret" auth setting must be at least 32 characters of random data';

		// 1. Thirty-one characters could be brute-forced offline from any token
		useAuth().registerSettings({ jwt: { secret: 'x'.repeat(31) } });
		await expect(jwtKeys()).rejects.toThrow(message);

		// 2. An explicit HS256 without any secret is the same mistake
		useAuth().registerSettings({ jwt: { algorithm: 'HS256' } });
		await expect(jwtKeys()).rejects.toThrow(message);
	});

	test('Imports an ES256 pair, the algorithm defaulting to it without a secret', async () => {
		useAuth().registerSettings({ jwt: await pemPair('ES256') });

		// 1. The private half signs, the public half verifies
		const keys = await jwtKeys();

		expect(keys.algorithm).toBe('ES256');
		expect((keys.signKey as CryptoKey).type).toBe('private');
		expect((keys.verifyKey as CryptoKey).type).toBe('public');
	});

	test('Imports an EdDSA pair', async () => {
		useAuth().registerSettings({ jwt: { algorithm: 'EdDSA', ...(await pemPair('EdDSA')) } });

		// 1. The named algorithm is kept
		expect((await jwtKeys()).algorithm).toBe('EdDSA');
	});

	test('Refuses an incomplete key pair', async () => {
		const { privateKey, publicKey } = await pemPair('ES256');

		// 1. Either half missing is named in the error
		useAuth().registerSettings({ jwt: { privateKey } });
		await expect(jwtKeys()).rejects.toThrow('The ES256 JWT algorithm needs a "privateKey" and a "publicKey"');

		useAuth().registerSettings({ jwt: { algorithm: 'EdDSA', publicKey } });
		await expect(jwtKeys()).rejects.toThrow('The EdDSA JWT algorithm needs a "privateKey" and a "publicKey"');
	});

	test('Imports once per settings object and again for a new one', async () => {
		const settings: AuthJwtSettings = { secret: SECRET };

		useAuth().registerSettings({ jwt: settings });

		// 1. The same object gives the same import
		expect(jwtKeys()).toBe(jwtKeys());

		const first = await jwtKeys();

		// 2. A new registration brings a new object, so rotated keys are picked up
		useAuth().registerSettings({ jwt: { secret: 'y'.repeat(32) } });
		expect(await jwtKeys()).not.toBe(first);
	});

	test('Does not cache a failed import, so fixing the settings object is seen at once', async () => {
		const settings: AuthJwtSettings = { secret: 'short' };

		useAuth().registerSettings({ jwt: settings });
		await expect(jwtKeys()).rejects.toThrow(/at least 32 characters/);

		// 1. The same object, now fixed, imports rather than replaying the cached failure
		settings.secret = SECRET;
		await expect(jwtKeys()).resolves.toMatchObject({ algorithm: 'HS256' });
	});
});
