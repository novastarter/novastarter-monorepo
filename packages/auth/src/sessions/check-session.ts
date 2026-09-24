import { authSettings } from '../lib/settings-access.js';
import type { SessionRecord } from '../types.js';

/**
 * What {@link checkSession} decided.
 *
 * - `invalid`: no session, or an expired one — the application deletes the record, if there was one.
 * - `valid`: the session holds. With `extended`, its `expiresAt` moved and the application stores the new deadline.
 */
export type SessionCheck =
	| { status: 'invalid' }
	| {
			status: 'valid';
			/** The session, with its current deadline. */
			session: SessionRecord;
			/** Whether the deadline moved and has to be stored. */
			extended: boolean;
	  };

/**
 * Judge a session the application found by its token's hash, and keep an idle session alive.
 *
 * With an idle lifetime in the settings, a session used after half of it has passed gets its deadline pushed back —
 * never past its hard end — so an active user stays signed in and the application writes at most once per half idle
 * lifetime rather than on every request.
 *
 * @param session - The record found by `hashToken(token)`; `undefined` or `null` when there was none.
 * @returns The verdict.
 * @example
 * ```ts
 * const found = await db.query.authSessions.findFirst({ where: eq(authSessions.id, hashToken(token)) });
 * const check = checkSession(found);
 *
 * if (check.status === 'invalid') {
 * 	if (found) await db.delete(authSessions).where(eq(authSessions.id, found.id));
 * 	redirect('/sign-in');
 * }
 *
 * if (check.extended) await db.update(authSessions).set({ expiresAt: check.session.expiresAt }).where(…);
 * ```
 */
export const checkSession = (session: SessionRecord | null | undefined): SessionCheck => {
	// No record, or one past its deadline, is no session; expiry is judged here so every application uses one clock
	const now = Date.now();

	if (!session || session.expiresAt <= now) {
		return { status: 'invalid' };
	}

	// Slide the idle deadline once half of the idle lifetime is gone, capped by the hard end
	const idleTtl = authSettings().session?.idleTtl;

	if (idleTtl && session.expiresAt - now < idleTtl / 2 && session.expiresAt < session.absoluteExpiresAt) {
		return {
			status: 'valid',
			session: { ...session, expiresAt: Math.min(now + idleTtl, session.absoluteExpiresAt) },
			extended: true,
		};
	}

	return { status: 'valid', session, extended: false };
};
