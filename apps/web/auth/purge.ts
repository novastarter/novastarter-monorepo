import { lte } from 'drizzle-orm';
import { useDb } from '../db';
import { authRefreshTokens, authSessions, authTokens } from '../db/schema';

/**
 * How many rows {@link purgeExpiredAuthRows} deleted, by table.
 */
export interface PurgedAuthRows {
	/** Expired sessions. */
	sessions: number;
	/** Expired one-time tokens. */
	tokens: number;
	/** Expired refresh tokens, used or not. */
	refreshTokens: number;
}

/**
 * Delete the auth rows past their deadline: sessions, one-time tokens and refresh tokens — for a scheduled job.
 *
 * Nothing depends on it for safety — every read judges expiry itself — it only keeps the tables small. Used refresh
 * tokens are kept until here on purpose: until it expires, a used token presented again is how a theft shows.
 *
 * @param now - The moment to compare with, epoch milliseconds; the current time unless given.
 * @returns How many rows went, by table.
 */
export const purgeExpiredAuthRows = async (now: number = Date.now()): Promise<PurgedAuthRows> => {
	const db = useDb();
	const cutoff = new Date(now);

	// Three independent deletes, in parallel: each touches only rows no read would accept any more
	const [sessions, tokens, refreshTokens] = await Promise.all([
		db.delete(authSessions).where(lte(authSessions.expiresAt, cutoff)).returning({ id: authSessions.id }),
		db.delete(authTokens).where(lte(authTokens.expiresAt, cutoff)).returning({ id: authTokens.id }),
		db
			.delete(authRefreshTokens)
			.where(lte(authRefreshTokens.expiresAt, cutoff))
			.returning({ id: authRefreshTokens.id }),
	]);

	return { sessions: sessions.length, tokens: tokens.length, refreshTokens: refreshTokens.length };
};
