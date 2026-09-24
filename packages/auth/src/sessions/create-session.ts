import { authSettings } from '../lib/settings-access.js';
import { DEFAULT_SESSION_TTL } from '../lib/settings.js';
import type { SessionRecord } from '../types.js';
import { hashToken, randomToken } from '../utils/index.js';

/**
 * Per-call options of {@link createSession}.
 */
export interface CreateSessionOptions {
	/** What to remember with the session: user agent, IP address, the provider signed in with. */
	metadata?: Record<string, unknown> | undefined;
}

/**
 * What {@link createSession} hands back.
 */
export interface CreatedSession {
	/** The token for the client — a cookie value. Shown once: the application stores only the record. */
	token: string;
	/** The record for the application to store; its `id` is the token's hash. */
	session: SessionRecord;
}

/**
 * Make a session for a signed-in user; the application stores the record.
 *
 * The token is 256 random bits; the record's `id` is its SHA-256, so a leaked table signs nobody in. The session ends
 * at its hard `ttl` from now, or earlier after `idleTtl` without use when the settings give one.
 *
 * @param userId - The user, in the application's own id format.
 * @param options - Metadata to keep with the session.
 * @returns The token for the client and the record to store.
 * @example
 * ```ts
 * const { token, session } = createSession(identity.subject, { metadata: { userAgent } });
 *
 * await db.insert(authSessions).values(session);
 * cookies().set('session', token, { httpOnly: true, secure: true, sameSite: 'lax', expires: session.expiresAt });
 * ```
 */
export const createSession = (userId: string, options: CreateSessionOptions = {}): CreatedSession => {
	const settings = authSettings().session ?? {};

	// Both deadlines from one clock reading; without an idle lifetime the idle deadline is the hard one
	const now = Date.now();
	const absoluteExpiresAt = now + (settings.ttl ?? DEFAULT_SESSION_TTL);
	const expiresAt = settings.idleTtl ? Math.min(now + settings.idleTtl, absoluteExpiresAt) : absoluteExpiresAt;

	// The client gets the token, the application its hash
	const token = randomToken();

	return {
		token,
		session: {
			id: hashToken(token),
			userId,
			createdAt: now,
			expiresAt,
			absoluteExpiresAt,
			...(options.metadata ? { metadata: options.metadata } : {}),
		},
	};
};
