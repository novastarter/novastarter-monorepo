import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The Drizzle schema of the app: every table `drizzle-kit generate` writes migrations for and `db.query` knows.
 *
 * Column names are given explicitly, so the mapping is the same whichever driver serves the location and needs no
 * `casing` option.
 */

/**
 * People with an account.
 */
export const users = pgTable('users', {
	/** Identity column: the database hands out the ids, so a client cannot choose one. */
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	/** Sign-in address, unique across accounts. */
	email: text('email').notNull().unique(),
	/** Display name; empty until the person sets one. */
	name: text('name'),
	/** scrypt hash of the password, in the PHC format of `@novastarter/auth`; empty for accounts without one. */
	passwordHash: text('password_hash'),
	/** When the row was created; set by the database. */
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	/** When the row was last changed; Drizzle sets it on every update it issues, the database on insert. */
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

/**
 * Signed-in sessions, by the hash of their token: the records `createSession()` of `@novastarter/auth` makes and
 * `auth/sessions.ts` stores. User ids are text, the way the package hands them over.
 */
export const authSessions = pgTable(
	'auth_sessions',
	{
		/** SHA-256 of the session token — `hashToken(token)`; the token itself is never stored. */
		id: text('id').primaryKey(),
		/** The user the session belongs to. */
		userId: text('user_id').notNull(),
		/** When the session was created. */
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
		/** The idle deadline, never later than `absoluteExpiresAt`; moved forward while the session is used. */
		expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
		/** The hard end of the session, however active it stays. */
		absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
		/** What the app attached at sign-in: user agent, IP address, the provider used. */
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
	},
	(table) => [
		index('auth_sessions_user_id_idx').on(table.userId),
		index('auth_sessions_expires_at_idx').on(table.expiresAt),
	],
);

/**
 * One-time tokens — password resets, email confirmations, sign-in links and codes — by purpose and the hash of the
 * token; stored by `auth/one-time-tokens.ts`.
 */
export const authTokens = pgTable(
	'auth_tokens',
	{
		/** What the token is for; part of the key, so a reset token can never be spent as a confirmation. */
		purpose: text('purpose').notNull(),
		/** `oneTimeTokenId(token, userId?)`: SHA-256 of the token, for a code of the user id and the code. */
		id: text('id').notNull(),
		/** The user the token belongs to; empty for a token made before anyone is known. */
		userId: text('user_id'),
		/** When the token was made. */
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
		/** When the token stops being accepted. */
		expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
		/** What the app attached: the address to confirm, the page to return to. */
		data: jsonb('data').$type<Record<string, unknown>>(),
	},
	(table) => [
		primaryKey({ name: 'auth_tokens_pk', columns: [table.purpose, table.id] }),
		index('auth_tokens_user_id_idx').on(table.userId),
		index('auth_tokens_expires_at_idx').on(table.expiresAt),
	],
);

/**
 * Refresh tokens, by the hash of the token, with the rotation family each belongs to; stored by
 * `auth/refresh-tokens.ts`. Used tokens stay until they expire, since a used one presented again is how a theft shows.
 */
export const authRefreshTokens = pgTable(
	'auth_refresh_tokens',
	{
		/** SHA-256 of the refresh token — `hashToken(token)`. */
		id: text('id').primaryKey(),
		/** The chain of rotations the token belongs to, from the sign-in that started it. */
		familyId: text('family_id').notNull(),
		/** The user the token belongs to. */
		userId: text('user_id').notNull(),
		/** When the token was issued. */
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
		/** When the token stops being accepted. */
		expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
		/** When the token was exchanged for its successor; empty while it is unused. */
		usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
	},
	(table) => [
		index('auth_refresh_tokens_family_id_idx').on(table.familyId),
		index('auth_refresh_tokens_user_id_idx').on(table.userId),
		index('auth_refresh_tokens_expires_at_idx').on(table.expiresAt),
	],
);

/**
 * TOTP enrolments, one per user; stored by `auth/mfa.ts`.
 */
export const authMfa = pgTable('auth_mfa', {
	/** The user enrolled. */
	userId: text('user_id').primaryKey(),
	/** The TOTP secret, encrypted with `AUTH_MFA_ENCRYPTION_KEY` by `enrollTotp()`. */
	secret: text('secret').notNull(),
	/** Whether the user proved the authenticator works; only a confirmed enrolment protects the account. */
	confirmed: boolean('confirmed').notNull().default(false),
	/** When the enrolment started. */
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
	/** The time step of the last accepted code; a code is accepted once, and never an older one. */
	lastStep: integer('last_step').notNull().default(0),
});

/**
 * Unused recovery codes, by user and the hash of the code; a spent code is deleted. Stored by `auth/mfa.ts`.
 */
export const authRecoveryCodes = pgTable(
	'auth_recovery_codes',
	{
		/** The user the code belongs to. */
		userId: text('user_id').notNull(),
		/** `recoveryCodeId(code)`: SHA-256 of the code in canonical form. */
		id: text('id').notNull(),
	},
	(table) => [primaryKey({ name: 'auth_recovery_codes_pk', columns: [table.userId, table.id] })],
);
