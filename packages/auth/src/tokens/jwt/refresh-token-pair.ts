import { AuthInvalidTokenError } from '../../errors/index.js';
import type { RefreshRecord } from '../../types.js';
import { hashToken } from '../../utils/index.js';
import { type IssueTokenPairOptions, makeTokenPair, type TokenPair } from './issue-token-pair.js';

/**
 * What {@link refreshTokenPair} needs: the refresh token, the storage steps and the claims of the new access token.
 */
export interface RefreshTokenPairOptions extends IssueTokenPairOptions {
	/** The refresh token the client sent. */
	token: string;
	/** Find the record by its id, `hashToken(token)`; `null` when there is none. */
	find: (id: string) => Promise<RefreshRecord | null | undefined>;
	/**
	 * Store `next`, then mark `current` used only if it is still unused — `UPDATE … SET used_at = now() WHERE id =
	 * $current.id AND used_at IS NULL RETURNING id` — and answer whether the mark moved. Of two concurrent refreshes with
	 * the same token only one wins; the other gets `false`, which is a replay. Storing `next` first means a crash in
	 * between leaves an unused token the client can retry with, rather than a family nobody can refresh.
	 */
	rotate: (current: RefreshRecord, next: RefreshRecord) => Promise<boolean>;
	/** Delete every token of a family: the stolen one, the one the client holds and every other in the chain. */
	revokeFamily: (familyId: string) => Promise<void>;
}

/**
 * What {@link refreshTokenPair} hands back.
 */
export interface RefreshedTokenPair {
	/** The user the token belonged to. */
	userId: string;
	/** The new tokens for the client. */
	pair: TokenPair;
}

/**
 * Exchange a refresh token for a new pair; the presented token works once.
 *
 * The application keeps used tokens until they expire rather than deleting them: a used one presented again gives a
 * theft away, and so does losing the race to rotate the same token — two parties hold it. Either way the whole family
 * is revoked, so the thief and the client both have to sign in again.
 *
 * @param options - The token, the storage steps and the claims of the new access token: read them afresh, a role may
 * have changed.
 * @returns The user and the new pair.
 * @throws AuthInvalidTokenError when the token is unknown, expired, used already, or rotated concurrently.
 * @throws Error when the JWT settings are missing or unusable.
 * @example
 * ```ts
 * const { pair } = await refreshTokenPair({
 * 	token,
 * 	find: async (id) => db.query.authRefreshTokens.findFirst({ where: eq(authRefreshTokens.id, id) }),
 * 	rotate: async (current, next) => {
 * 		await db.insert(authRefreshTokens).values(next);
 *
 * 		return (await db.update(authRefreshTokens).set({ usedAt: new Date() })
 * 			.where(and(eq(authRefreshTokens.id, current.id), isNull(authRefreshTokens.usedAt))).returning()).length > 0;
 * 	},
 * 	revokeFamily: async (familyId) => {
 * 		await db.delete(authRefreshTokens).where(eq(authRefreshTokens.familyId, familyId));
 * 	},
 * });
 * ```
 */
export const refreshTokenPair = async (options: RefreshTokenPairOptions): Promise<RefreshedTokenPair> => {
	// 1. Looked up by the token's hash; no record, or an expired one, refreshes nothing — one error for both
	const record = await options.find(hashToken(options.token));

	if (!record || record.expiresAt <= Date.now()) {
		throw new AuthInvalidTokenError();
	}

	// 2. A used token presented again is a replay: the family goes, whoever holds its latest token included, and the
	//    caller learns no more than that the token is invalid
	if (record.usedAt !== null) {
		await options.revokeFamily(record.familyId);

		throw new AuthInvalidTokenError();
	}

	// 3. The successor stays in the family, so revoking the family later reaches it too
	const { pair, refresh } = await makeTokenPair(record.userId, record.familyId, options.claims);

	// 4. The conditional mark decides which of two concurrent rotations won; the loser is treated as the replay it is
	if (!(await options.rotate(record, refresh))) {
		await options.revokeFamily(record.familyId);

		throw new AuthInvalidTokenError();
	}

	return { userId: record.userId, pair };
};
