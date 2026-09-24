import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The SHA-256 of a token, base64url: the id the application stores a session or refresh token under, and looks it up
 * by.
 *
 * A fast hash is enough for a token of 256 random bits — there is nothing to brute-force — and it lets the application
 * look the token up by its hash, which a salted password hash would not. A leaked table then holds nothing that signs
 * a request in.
 *
 * @param token - The token as the client holds it.
 * @returns Its hash.
 * @example
 * ```ts
 * const found = await db.query.authSessions.findFirst({ where: eq(authSessions.id, hashToken(token)) });
 * ```
 */
export const hashToken = (token: string): string => {
	// base64url, like the tokens themselves, so the hash is a plain key on every backend
	return createHash('sha256').update(token, 'utf8').digest('base64url');
};

/**
 * Compare two strings in time that does not depend on where they differ.
 *
 * @param left - One string.
 * @param right - The other.
 * @returns Whether they are equal.
 * @internal
 */
export const safeEqual = (left: string, right: string): boolean => {
	// `timingSafeEqual` refuses buffers of different lengths; comparing their hashes keeps the lengths equal and the
	// time constant, where an early length check would tell an attacker the length
	const a = createHash('sha256').update(left, 'utf8').digest();
	const b = createHash('sha256').update(right, 'utf8').digest();

	return timingSafeEqual(a, b);
};
