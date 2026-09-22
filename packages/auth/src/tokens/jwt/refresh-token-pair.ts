import { AuthInvalidTokenError } from '../../errors/index.js';
import type { RefreshRecord } from '../../types.js';
import { type IssueTokenPairOptions, makeTokenPair, type TokenPair } from './issue-token-pair.js';

/**
 * What {@link refreshTokenPair} decided.
 *
 * - `rotated`: the token was unused. The application marks it used — atomically, only if it is still unused — and
 *   stores `next`; if that conditional update matched nothing, another request rotated it first, which is a replay.
 * - `reused`: the token was used before. Two parties hold it — the client and a thief — so the application deletes the
 *   whole family, and both have to sign in again.
 */
export type RefreshOutcome =
	| {
			status: 'rotated';
			/** The user the token belonged to. */
			userId: string;
			/** The new tokens for the client. */
			pair: TokenPair;
			/** The successor's record, in the same family, for the application to store. */
			next: RefreshRecord;
	  }
	| {
			status: 'reused';
			/** The user the token belonged to. */
			userId: string;
			/** The family to delete. */
			familyId: string;
	  };

/**
 * Judge a refresh token the application found by its hash, and prepare its successor.
 *
 * Each refresh token works once. The application keeps used tokens until they expire rather than deleting them: a used
 * one presented again is how a theft shows.
 *
 * @param record - The record found by `hashToken(refreshToken)`; `undefined` or `null` when there was none.
 * @param options - Extra claims of the new access token: read them afresh, a role may have changed.
 * @returns The verdict: the new pair and the successor, or the family to revoke.
 * @throws AuthInvalidTokenError when there was no record or it expired.
 * @throws Error when the JWT settings are missing or unusable.
 * @example
 * ```ts
 * const found = await db.query.authRefreshTokens.findFirst({ where: eq(authRefreshTokens.id, hashToken(token)) });
 * const outcome = await refreshTokenPair(found);
 *
 * if (outcome.status === 'reused') {
 * 	await db.delete(authRefreshTokens).where(eq(authRefreshTokens.familyId, outcome.familyId));
 * 	throw new AuthInvalidTokenError();
 * }
 *
 * await db.insert(authRefreshTokens).values(outcome.next);
 * const marked = await db.update(authRefreshTokens).set({ usedAt: new Date() })
 * 	.where(and(eq(authRefreshTokens.id, found!.id), isNull(authRefreshTokens.usedAt))).returning();
 *
 * // Another request rotated the same token first: a replay, handled like `reused`
 * if (marked.length === 0) {
 * 	await db.delete(authRefreshTokens).where(eq(authRefreshTokens.familyId, found!.familyId));
 * 	throw new AuthInvalidTokenError();
 * }
 *
 * return outcome.pair;
 * ```
 */
export const refreshTokenPair = async (
	record: RefreshRecord | null | undefined,
	options: IssueTokenPairOptions = {},
): Promise<RefreshOutcome> => {
	// 1. No record, or an expired one, refreshes nothing; one error for both
	if (!record || record.expiresAt <= Date.now()) {
		throw new AuthInvalidTokenError();
	}

	// 2. A used token presented again is a replay: the family goes, whoever holds its latest token included
	if (record.usedAt !== null) {
		return { status: 'reused', userId: record.userId, familyId: record.familyId };
	}

	// 3. The successor stays in the family, so revoking the family later reaches it too
	const { pair, refresh } = await makeTokenPair(record.userId, record.familyId, options.claims);

	return { status: 'rotated', userId: record.userId, pair, next: refresh };
};
