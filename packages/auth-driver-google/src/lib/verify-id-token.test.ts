/**
 * Tests of `verify-id-token` on a local key set: a good token, and each check that refuses one — signature, issuer,
 * audience, expiry, nonce and subject.
 */
import { AuthProviderFailedError } from '@novastarter/auth';
import { createLocalJWKSet, type CryptoKey, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { beforeAll, describe, expect, test } from 'vitest';
import { verifyIdToken } from './verify-id-token.js';

/**
 * The key Google would sign with, and the local set holding its public half.
 */
let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
	// 1. One RS256 pair for the whole file: generating keys is the slow part
	const pair = await generateKeyPair('RS256');

	privateKey = pair.privateKey;
	jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
});

/**
 * Sign an ID token the way Google does, with overrides for the claim under test.
 *
 * @param claims - Claims to add or replace.
 * @param options - Another issuer, audience, subject, expiry or signing key.
 * @returns The compact JWT.
 */
const sign = async (
	claims: JWTPayload = {},
	options: { issuer?: string; audience?: string; subject?: string; expires?: string; key?: CryptoKey } = {},
): Promise<string> => {
	// 1. A token that passes every check unless an override breaks one
	const jwt = new SignJWT({ nonce: 'nonce-1', email: 'ada@example.com', ...claims })
		.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
		.setIssuer(options.issuer ?? 'https://accounts.google.com')
		.setAudience(options.audience ?? 'client-1')
		.setIssuedAt()
		.setExpirationTime(options.expires ?? '5m');

	// 2. An empty subject override leaves the claim out entirely
	if (options.subject !== '') {
		jwt.setSubject(options.subject ?? '1234567890');
	}

	return jwt.sign(options.key ?? privateKey);
};

describe('verifyIdToken', () => {
	test('Answers the claims of a token that passes every check, with either issuer form', async () => {
		const options = { jwks, audience: 'client-1', nonce: 'nonce-1' };

		// 1. Google documents both issuer spellings, and either is accepted
		expect(await verifyIdToken(await sign(), options)).toMatchObject({ sub: '1234567890', email: 'ada@example.com' });

		expect(await verifyIdToken(await sign({}, { issuer: 'accounts.google.com' }), options)).toMatchObject({
			sub: '1234567890',
		});
	});

	test('Refuses a token signed by another key, for another client, from another issuer or expired', async () => {
		const options = { jwks, audience: 'client-1', nonce: 'nonce-1' };
		const other = (await generateKeyPair('RS256')).privateKey;

		// 1. Each check of `jose` surfaces as a provider failure with the `jose` error as the cause
		for (const token of [
			await sign({}, { key: other }),
			await sign({}, { audience: 'client-2' }),
			await sign({}, { issuer: 'https://evil.test' }),
			await sign({}, { expires: '-1m' }),
		]) {
			const error = await verifyIdToken(token, options).catch((thrown: unknown) => thrown);

			expect(error).toBeInstanceOf(AuthProviderFailedError);
			expect((error as Error).message).toMatch(/^The google sign-in failed: the ID token did not verify: /);
			expect((error as Error).cause).toBeInstanceOf(Error);
		}
	});

	test('Refuses a token with another nonce or without a subject', async () => {
		const options = { jwks, audience: 'client-1', nonce: 'nonce-1' };

		// 1. A token from another sign-in carries another nonce, even when its signature is good
		await expect(verifyIdToken(await sign({ nonce: 'nonce-2' }), options)).rejects.toThrow(
			'the ID token nonce does not match',
		);

		await expect(verifyIdToken(await sign({ nonce: undefined }), options)).rejects.toThrow(
			'the ID token nonce does not match',
		);

		// 2. Without a subject there is nothing to link the account by
		await expect(verifyIdToken(await sign({}, { subject: '' }), options)).rejects.toThrow(
			'the ID token has no subject',
		);
	});
});
