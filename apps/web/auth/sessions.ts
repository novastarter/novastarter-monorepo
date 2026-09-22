import { checkSession, type CreatedSession, createSession, hashToken, type SessionRecord } from '@novastarter/auth';
import { and, desc, eq, gt } from 'drizzle-orm';
import { useDb } from '../db';
import { authSessions } from '../db/schema';

/**
 * A row of `auth_sessions`, as Drizzle reads it.
 *
 * @internal
 */
type SessionRow = typeof authSessions.$inferSelect;

/**
 * Turn a row into the record `@novastarter/auth` judges: dates become epoch milliseconds, an empty metadata column
 * becomes an absent field.
 *
 * @param row - The row.
 * @returns The record.
 * @internal
 */
const toRecord = (row: SessionRow): SessionRecord => {
	// 1. The package counts in epoch milliseconds, so a record survives JSON; the column keeps real timestamps
	return {
		id: row.id,
		userId: row.userId,
		createdAt: row.createdAt.getTime(),
		expiresAt: row.expiresAt.getTime(),
		absoluteExpiresAt: row.absoluteExpiresAt.getTime(),
		...(row.metadata ? { metadata: row.metadata } : {}),
	};
};

/**
 * Sign a user in: make a session and store it.
 *
 * @param userId - The user, as a string — the id format of `@novastarter/auth`.
 * @param metadata - What to keep with the session: user agent, IP address, the provider signed in with.
 * @returns The token for the cookie, shown once, and the stored record.
 * @example
 * ```ts
 * const { token, session } = await startSession(identity.subject, { userAgent });
 *
 * cookies().set('session', token, { httpOnly: true, secure: true, sameSite: 'lax', expires: session.expiresAt });
 * ```
 */
export const startSession = async (userId: string, metadata?: Record<string, unknown>): Promise<CreatedSession> => {
	// 1. The package makes the token and the record; only the record, keyed by the token's hash, is stored
	const created = createSession(userId, metadata ? { metadata } : {});
	const { session } = created;

	await useDb()
		.insert(authSessions)
		.values({
			id: session.id,
			userId: session.userId,
			createdAt: new Date(session.createdAt),
			expiresAt: new Date(session.expiresAt),
			absoluteExpiresAt: new Date(session.absoluteExpiresAt),
			metadata: session.metadata ?? null,
		});

	return created;
};

/**
 * Find the session a cookie's token belongs to, dropping it when it expired and sliding its idle deadline when due.
 *
 * @param token - The token from the cookie.
 * @returns The live session; `null` when there is none.
 */
export const readSession = async (token: string): Promise<SessionRecord | null> => {
	const db = useDb();

	// 1. Looked up by the token's hash: the table never holds a token that signs anybody in
	const [row] = await db
		.select()
		.from(authSessions)
		.where(eq(authSessions.id, hashToken(token)))
		.limit(1);

	const check = checkSession(row ? toRecord(row) : null);

	// 2. An expired session is deleted on sight, so the table does not wait for the purge to forget it
	if (check.status === 'invalid') {
		if (row) {
			await db.delete(authSessions).where(eq(authSessions.id, row.id));
		}

		return null;
	}

	// 3. A moved idle deadline is written back; the package moves it at most once per half idle lifetime
	if (check.extended) {
		await db
			.update(authSessions)
			.set({ expiresAt: new Date(check.session.expiresAt) })
			.where(eq(authSessions.id, check.session.id));
	}

	return check.session;
};

/**
 * Sign the holder of a token out.
 *
 * @param token - The token from the cookie.
 * @returns Once the session, if there was one, is gone.
 */
export const endSession = async (token: string): Promise<void> => {
	// 1. By the token's hash; a token that matches nothing is already signed out
	await useDb()
		.delete(authSessions)
		.where(eq(authSessions.id, hashToken(token)));
};

/**
 * End one of a user's sessions by its id — "sign out that device" on a sessions page.
 *
 * @param userId - The user asking; the session must be theirs.
 * @param id - The session's id, as {@link listSessions} gave it.
 * @returns Whether a session of the user was ended.
 */
export const endSessionById = async (userId: string, id: string): Promise<boolean> => {
	// 1. The user is part of the condition, so nobody ends another person's session by guessing or copying its id
	const deleted = await useDb()
		.delete(authSessions)
		.where(and(eq(authSessions.id, id), eq(authSessions.userId, userId)))
		.returning({ id: authSessions.id });

	return deleted.length > 0;
};

/**
 * Sign a user out everywhere — after a password change, or when an account is compromised.
 *
 * @param userId - The user.
 * @returns How many sessions were ended.
 */
export const endAllSessions = async (userId: string): Promise<number> => {
	// 1. Every session of the user, the caller's own included; the caller starts a fresh one if it wants to stay in
	const deleted = await useDb()
		.delete(authSessions)
		.where(eq(authSessions.userId, userId))
		.returning({ id: authSessions.id });

	return deleted.length;
};

/**
 * A user's live sessions, newest first — for a page that lists where they are signed in.
 *
 * @param userId - The user.
 * @returns The sessions that have not expired.
 */
export const listSessions = async (userId: string): Promise<SessionRecord[]> => {
	// 1. Expired rows wait for the purge; they are no longer sessions, so they are left out here
	const rows = await useDb()
		.select()
		.from(authSessions)
		.where(and(eq(authSessions.userId, userId), gt(authSessions.expiresAt, new Date())))
		.orderBy(desc(authSessions.createdAt));

	return rows.map(toRecord);
};
