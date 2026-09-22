import { type JWTPayload, jwtVerify } from 'jose';
import { AuthInvalidTokenError } from '../../errors/index.js';
import { ACCESS_TOKEN_TYPE } from './issue-token-pair.js';
import { jwtKeys } from './keys.js';

/**
 * What {@link verifyAccessToken} hands back.
 */
export interface VerifiedAccessToken {
	/** The user, from the `sub` claim. */
	userId: string;
	/** Every claim of the token, the custom ones included. */
	claims: JWTPayload & Record<string, unknown>;
}

/**
 * Check a JWT access token {@link issueTokenPair} issued: signature, algorithm, type, expiry, issuer and audience.
 *
 * No lookup: the signature is the proof. The algorithm is the configured one only, so a token claiming
 * `none` or switching to HMAC with the public key is refused.
 *
 * @param token - The token, without the `Bearer ` prefix.
 * @returns The user and the claims.
 * @throws AuthInvalidTokenError when any check fails; the reason is the `cause`.
 * @throws Error when the JWT settings are missing or unusable.
 * @example
 * ```ts
 * const { userId, claims } = await verifyAccessToken(request.headers.get('authorization')?.slice(7) ?? '');
 * ```
 */
export const verifyAccessToken = async (token: string): Promise<VerifiedAccessToken> => {
	// 1. The keys first: a configuration error is thrown as itself, not hidden behind an invalid token
	const keys = await jwtKeys();

	// 2. Every check jose knows, pinned to the settings; its errors become the one error a caller handles
	try {
		const { payload } = await jwtVerify(token, keys.verifyKey, {
			algorithms: [keys.algorithm],
			typ: ACCESS_TOKEN_TYPE,
			requiredClaims: ['sub', 'exp'],
			...(keys.settings.issuer ? { issuer: keys.settings.issuer } : {}),
			...(keys.settings.audience ? { audience: keys.settings.audience } : {}),
		});

		return { userId: payload.sub!, claims: payload as JWTPayload & Record<string, unknown> };
	} catch (error) {
		throw new AuthInvalidTokenError(undefined, { cause: error });
	}
};
