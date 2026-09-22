/**
 * A signed-in session, as the application stores it. Times are epoch milliseconds, so a record survives JSON.
 */
export interface SessionRecord {
	/** SHA-256 of the session token — `hashToken(token)`; the token itself is never stored. */
	id: string;
	/** Who the session belongs to, in the application's own id format. */
	userId: string;
	/** When the session was created. */
	createdAt: number;
	/** When the session stops being valid: the idle deadline, never later than {@link absoluteExpiresAt}. */
	expiresAt: number;
	/** The hard end of the session, however active it stays. */
	absoluteExpiresAt: number;
	/** What the application attached at sign-in: user agent, IP address, the provider used. */
	metadata?: Record<string, unknown> | undefined;
}

/**
 * A one-time token, as the application stores it: a password reset, an email confirmation, a sign-in link or code.
 */
export interface TokenRecord {
	/** `oneTimeTokenId(token, userId?)`: SHA-256 of the token — for a numeric code, of the user id and the code. */
	id: string;
	/** What the token is for; a token is only accepted for the purpose it was made for. */
	purpose: string;
	/** Who the token belongs to. */
	userId?: string | undefined;
	/** When the token was made. */
	createdAt: number;
	/** When the token stops being accepted. */
	expiresAt: number;
	/** What the application attached: the address to confirm, the page to return to. */
	data?: Record<string, unknown> | undefined;
}

/**
 * A refresh token, as the application stores it.
 *
 * Every rotation marks the presented token used and stores its successor in the same family; a used token presented
 * again gives the theft away, and the application deletes the whole family.
 */
export interface RefreshRecord {
	/** SHA-256 of the refresh token — `hashToken(token)`. */
	id: string;
	/** The chain of rotations the token belongs to, from the sign-in that started it. */
	familyId: string;
	/** Who the token belongs to. */
	userId: string;
	/** When the token was issued. */
	createdAt: number;
	/** When the token stops being accepted. */
	expiresAt: number;
	/** When the token was exchanged for its successor; `null` while it is unused. */
	usedAt: number | null;
}
