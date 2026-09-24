import { hashToken, issueTokenPair, type RefreshRecord, refreshTokenPair, type TokenPair } from '@novastarter/auth';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { useDb } from '../db';
import { authRefreshTokens } from '../db/schema';

/**
 * A row of `auth_refresh_tokens`, as Drizzle reads it.
 *
 * @internal
 */
type RefreshRow = typeof authRefreshTokens.$inferSelect;

/**
 * What {@link refreshTokens} hands back.
 */
export interface RefreshedTokens {
	/** The user the token belonged to. */
	userId: string;
	/** The new tokens for the client. */
	pair: TokenPair;
}

/**
 * Turn a row into the record `@novastarter/auth` judges: dates become epoch milliseconds.
 *
 * @param row - The row.
 * @returns The record.
 * @internal
 */
const toRecord = (row: RefreshRow): RefreshRecord => {
	// The package counts in epoch milliseconds; an unused token keeps `null`
	return {
		id: row.id,
		familyId: row.familyId,
		userId: row.userId,
		createdAt: row.createdAt.getTime(),
		expiresAt: row.expiresAt.getTime(),
		usedAt: row.usedAt ? row.usedAt.getTime() : null,
	};
};

/**
 * Turn a record into the row to insert.
 *
 * @param record - The record the package made.
 * @returns The row.
 * @internal
 */
const toRow = (record: RefreshRecord): RefreshRow => {
	return {
		id: record.id,
		familyId: record.familyId,
		userId: record.userId,
		createdAt: new Date(record.createdAt),
		expiresAt: new Date(record.expiresAt),
		usedAt: record.usedAt === null ? null : new Date(record.usedAt),
	};
};

/**
 * Delete a whole refresh family: the stolen token, the one the client holds and every other in the chain.
 *
 * @param familyId - The family.
 * @returns Once the family is gone.
 * @internal
 */
const deleteFamily = async (familyId: string): Promise<void> => {
	// By family, so the successor a thief or the client got most recently goes too
	await useDb().delete(authRefreshTokens).where(eq(authRefreshTokens.familyId, familyId));
};

/**
 * Issue a JWT access token and a refresh token after sign-in — for a mobile app or an API client — and store the
 * refresh token.
 *
 * @param userId - The user, as a string.
 * @param claims - Extra claims of the access token: roles, the tenant. Signed, not encrypted.
 * @returns The pair for the client.
 * @throws Error when the JWT settings are missing or unusable.
 * @example
 * ```ts
 * return Response.json(await issueTokens(identity.subject, { role: 'admin' }));
 * ```
 */
export const issueTokens = async (userId: string, claims?: Record<string, unknown>): Promise<TokenPair> => {
	// A new family per sign-in; only its first token's hash is stored
	const { pair, refresh } = await issueTokenPair(userId, claims ? { claims } : {});

	await useDb().insert(authRefreshTokens).values(toRow(refresh));

	return pair;
};

/**
 * Exchange a refresh token for a new pair; the presented token works once.
 *
 * A used token presented again gives a theft away, and so does losing the race to rotate the same token: two parties
 * hold it. Either way the package deletes the whole family through {@link deleteFamily}, so the thief and the client
 * both have to sign in again.
 *
 * The successor is stored before the token is marked used, so a crash between the two leaves an unused token the
 * client can retry with rather than a family nobody can refresh. The mark is one conditional `UPDATE … WHERE used_at
 * IS NULL RETURNING`: of two concurrent rotations only one moves it, and the other is treated as the replay it is.
 *
 * @param token - The refresh token the client sent.
 * @param claims - Extra claims of the new access token: read them afresh, a role may have changed.
 * @returns The user and the new pair.
 * @throws AuthInvalidTokenError when the token is unknown, expired, used already, or rotated concurrently.
 * @throws Error when the JWT settings are missing or unusable.
 */
export const refreshTokens = async (token: string, claims?: Record<string, unknown>): Promise<RefreshedTokens> => {
	const db = useDb();

	// The package looks the token up, judges it and decides on a replay; the app supplies the three statements
	return refreshTokenPair({
		token,
		...(claims ? { claims } : {}),
		find: async (id) => {
			const [row] = await db.select().from(authRefreshTokens).where(eq(authRefreshTokens.id, id)).limit(1);

			return row ? toRecord(row) : null;
		},
		rotate: async (current, next) => {
			await db.insert(authRefreshTokens).values(toRow(next));

			const marked = await db
				.update(authRefreshTokens)
				.set({ usedAt: new Date() })
				.where(and(eq(authRefreshTokens.id, current.id), isNull(authRefreshTokens.usedAt)))
				.returning({ id: authRefreshTokens.id });

			return marked.length > 0;
		},
		revokeFamily: deleteFamily,
	});
};

/**
 * Sign an API client out: revoke the refresh token's whole family.
 *
 * @param token - The refresh token the client holds.
 * @returns Once the family, if the token matched one, is gone.
 */
export const revokeRefreshToken = async (token: string): Promise<void> => {
	const db = useDb();

	// One statement: the family of the token's row, looked up by the token's hash inside the delete
	await db.delete(authRefreshTokens).where(
		inArray(
			authRefreshTokens.familyId,
			db
				.select({ familyId: authRefreshTokens.familyId })
				.from(authRefreshTokens)
				.where(eq(authRefreshTokens.id, hashToken(token))),
		),
	);
};

/**
 * Revoke every refresh token of a user — after a password change, or when an account is compromised.
 *
 * @param userId - The user.
 * @returns How many refresh tokens were deleted.
 */
export const revokeAllRefreshTokens = async (userId: string): Promise<number> => {
	// Every family of the user, used tokens included: none of them may refresh or prove a theft any more
	const deleted = await useDb()
		.delete(authRefreshTokens)
		.where(eq(authRefreshTokens.userId, userId))
		.returning({ id: authRefreshTokens.id });

	return deleted.length;
};
