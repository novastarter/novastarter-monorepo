import { checkSession, type CreatedSession, createSession, hashToken, type SessionRecord } from '@novastarter/auth';
import { useLogger } from '@novastarter/logger';
import { useCache } from '@novastarter/memory';
import { toError } from '@novastarter/utils';
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
 * The cache key of a session, by its id.
 *
 * @param id - The session id: the token's hash.
 * @returns The key.
 * @internal
 */
const cacheKey = (id: string): string => `auth-session:${id}`;

/**
 * Sessions in front of `auth_sessions`: the `default` cache location — Redis when the app has one, in-process otherwise
 * — whose ttl (60 s) bounds how long a copy may outlive its row.
 *
 * Postgres stays the source of truth: every change goes to the table first and to the cache second, so a lost or
 * flushed cache only costs one query per session. A cache that fails is logged and skipped rather than failing the
 * request — reading the table is always an answer. Two cases leave a copy readable until the cache's ttl runs out: a row
 * deleted behind these functions' back (by hand, from another tool), and a sign-out that lands between a cache miss's
 * read of the row and its write to the cache — a window of one query.
 *
 * @internal
 */
const cache = {
	/**
	 * Read a cached session.
	 *
	 * @param id - The session id.
	 * @returns The session; `undefined` when not cached or when the cache failed.
	 */
	async get(id: string): Promise<SessionRecord | undefined> {
		// 1. A failing cache is a miss: the table answers instead
		try {
			return await useCache().location().get<SessionRecord>(cacheKey(id));
		} catch (error) {
			useLogger().warn(toError(error), 'Session cache read failed; reading the table');

			return undefined;
		}
	},

	/**
	 * Cache a session.
	 *
	 * @param session - The session, as stored in the table.
	 * @returns Once it is cached, or the failure logged.
	 */
	async set(session: SessionRecord): Promise<void> {
		// 1. A copy that could not be written only means the next read goes to the table
		try {
			await useCache().location().set(cacheKey(session.id), session);
		} catch (error) {
			useLogger().warn(toError(error), 'Session cache write failed');
		}
	},

	/**
	 * Drop cached sessions.
	 *
	 * @param ids - The session ids.
	 * @returns Once they are dropped, or the failure logged.
	 */
	async delete(ids: string[]): Promise<void> {
		// 1. A drop that failed leaves a copy readable until the cache's ttl — logged, since sign-out is then late
		try {
			await Promise.all(ids.map((id) => useCache().location().delete(cacheKey(id))));
		} catch (error) {
			useLogger().error(toError(error), 'Session cache delete failed; the session stays readable until the cache ttl');
		}
	},
};

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

	// 2. Cached right away: the request after sign-in reads it without a query
	await cache.set(session);

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
	const id = hashToken(token);

	// 1. The cache first — this runs on every request; the table, keyed by the token's hash, on a miss
	let found = await cache.get(id);
	let cached = found !== undefined;

	if (!found) {
		const [row] = await db.select().from(authSessions).where(eq(authSessions.id, id)).limit(1);

		found = row ? toRecord(row) : undefined;
	}

	const check = checkSession(found);

	// 2. An expired session is deleted on sight, from the table and the cache, so neither waits for the purge
	if (check.status === 'invalid') {
		if (found) {
			await db.delete(authSessions).where(eq(authSessions.id, found.id));
			await cache.delete([found.id]);
		}

		return null;
	}

	// 3. A moved idle deadline is written back to the table, then to the cache; the package moves it at most once per
	//    half idle lifetime, so this stays rare. An update that matched no row means the session was ended meanwhile
	//    — caching it again would bring it back, so it is dropped instead
	if (check.extended) {
		const updated = await db
			.update(authSessions)
			.set({ expiresAt: new Date(check.session.expiresAt) })
			.where(eq(authSessions.id, check.session.id))
			.returning({ id: authSessions.id });

		if (updated.length === 0) {
			await cache.delete([check.session.id]);

			return null;
		}

		cached = false;
	}

	// 4. A session read from the table, or one whose deadline moved, is (re)cached for the next request
	if (!cached) {
		await cache.set(check.session);
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
	const id = hashToken(token);

	// 1. By the token's hash, from the table and then the cache, so the sign-out holds on the very next request; a
	//    token that matches nothing is already signed out
	await useDb().delete(authSessions).where(eq(authSessions.id, id));
	await cache.delete([id]);
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

	// 2. Only a session that was really the user's leaves the cache; another id is left alone
	await cache.delete(deleted.map((row) => row.id));

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

	// 2. The deleted ids come back from the table, which is how the cache — keyed by session, not by user — is cleared
	await cache.delete(deleted.map((row) => row.id));

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
