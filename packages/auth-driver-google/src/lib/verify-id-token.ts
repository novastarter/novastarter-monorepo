import { AuthProviderFailedError } from '@novastarter/auth';
import { toErrorMessage } from '@novastarter/utils';
import { type JWTPayload, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { CLOCK_TOLERANCE, ISSUERS, PROVIDER } from './constants.js';

/**
 * What an ID token is checked against.
 */
export interface VerifyIdTokenOptions {
	/** The keys the signature must verify with: Google's remote set, or a local one in tests. */
	jwks: JWTVerifyGetKey;
	/** The OAuth client id; the token's audience must be it. */
	audience: string;
	/** The nonce sent with the authorization; the token's `nonce` claim must be it. */
	nonce: string;
}

/**
 * Verify an ID token from Google and answer its claims.
 *
 * The signature (RS256 only, so a token cannot choose a weaker algorithm), the issuer, the audience and the expiry
 * are checked by `jose`, with {@link CLOCK_TOLERANCE} of clock skew allowed — a server a few seconds fast must not
 * reject a token in the last moments of its validity; the nonce is checked here, since it ties the token to the
 * sign-in `startOAuth()` began, and a token without a subject is refused, as the subject is what identifies the person.
 *
 * @param idToken - The compact JWT from the token endpoint.
 * @param options - The keys, the audience and the nonce.
 * @returns The verified claims, with `sub` present.
 * @throws AuthProviderFailedError when any check fails, with the `jose` error as the cause.
 * @example
 * ```ts
 * const claims = await verifyIdToken(idToken, { jwks, audience: clientId, nonce });
 * ```
 */
export const verifyIdToken = async (idToken: string, options: VerifyIdTokenOptions): Promise<JWTPayload> => {
	// The tolerance forgives a verifying clock a little ahead of Google's, so a token at the end of its life is not
	// refused by skew alone
	let payload: JWTPayload;

	try {
		({ payload } = await jwtVerify(idToken, options.jwks, {
			issuer: ISSUERS,
			audience: options.audience,
			algorithms: ['RS256'],
			clockTolerance: CLOCK_TOLERANCE,
		}));
	} catch (error) {
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: `the ID token did not verify: ${toErrorMessage(error)}` },
			{ cause: error },
		);
	}

	// A token minted for another sign-in, replayed or injected, carries another nonce
	if (payload['nonce'] !== options.nonce) {
		throw new AuthProviderFailedError({ provider: PROVIDER, reason: 'the ID token nonce does not match' });
	}

	// The subject is the stable id the application links the account by; a token without one is useless
	if (typeof payload.sub !== 'string' || !payload.sub) {
		throw new AuthProviderFailedError({ provider: PROVIDER, reason: 'the ID token has no subject' });
	}

	return payload;
};
