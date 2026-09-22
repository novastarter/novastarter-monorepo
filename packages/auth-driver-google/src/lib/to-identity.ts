import type { AuthIdentity } from '@novastarter/auth';
import type { JWTPayload } from 'jose';
import { PROVIDER } from './constants.js';

/**
 * Read a claim that should be a string, dropping it when it is anything else.
 *
 * @param claims - The ID token's claims.
 * @param name - The claim to read.
 * @returns The claim, or `undefined` when it is missing, empty or not a string.
 * @internal
 */
const stringClaim = (claims: JWTPayload, name: string): string | undefined => {
	// 1. Only a non-empty string is worth passing on; a malformed claim is left out rather than trusted
	const value = claims[name];

	return typeof value === 'string' && value ? value : undefined;
};

/**
 * Turn the verified claims of a Google ID token into the identity `finishOAuth()` hands the application.
 *
 * `email_verified` is taken as a boolean and, defensively, as the string `true`: only a verified address may be used
 * to link accounts, so anything else counts as unverified. Absent claims are left out rather than set to `undefined`.
 *
 * @param claims - The claims {@link verifyIdToken} answered, with `sub` present.
 * @returns The identity, with the claims as `raw`.
 * @example
 * ```ts
 * const identity = toIdentity(await verifyIdToken(idToken, options));
 * ```
 */
export const toIdentity = (claims: JWTPayload): AuthIdentity => {
	// 1. The fields a scope did not grant are simply absent: no `profile`, no name or picture
	const email = stringClaim(claims, 'email');
	const name = stringClaim(claims, 'name');
	const avatarUrl = stringClaim(claims, 'picture');
	const verified = claims['email_verified'];

	// 2. Verification only means something with an address to verify
	return {
		provider: PROVIDER,
		subject: String(claims.sub),
		...(email ? { email, emailVerified: verified === true || verified === 'true' } : {}),
		...(name ? { name } : {}),
		...(avatarUrl ? { avatarUrl } : {}),
		raw: claims,
	};
};
