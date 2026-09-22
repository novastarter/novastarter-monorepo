import { hashToken } from '../utils/index.js';

/**
 * The record id of a one-time token: what the application looks the token up by.
 *
 * A code is hashed together with its user — a million codes would collide across users, the pair does not — so the
 * user is given for a code and omitted for a link.
 *
 * @param token - The token as the client sent it.
 * @param userId - The user a code was made for; omitted for a link token.
 * @returns The id.
 * @example
 * ```ts
 * const [record] = await db.delete(authTokens).where(eq(authTokens.id, oneTimeTokenId(token))).returning();
 * ```
 */
export const oneTimeTokenId = (token: string, userId?: string): string => {
	// 1. Surrounding whitespace is not part of a token, and a pasted one often carries some; a NUL separator cannot
	//    occur in either part, so no user id and code can hash like another pair
	const clean = String(token).trim();

	return hashToken(userId === undefined ? clean : `${userId}\u0000${clean}`);
};
