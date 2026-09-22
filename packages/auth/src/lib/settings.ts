import type { LimiterDriver } from '@novastarter/memory';

/**
 * How long a session lasts however active it stays, in milliseconds.
 *
 * @defaultValue 30 days.
 */
export const DEFAULT_SESSION_TTL: number = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a one-time token is accepted, in milliseconds.
 *
 * @defaultValue 1 hour.
 */
export const DEFAULT_TOKEN_TTL: number = 60 * 60 * 1000;

/**
 * How long a one-time numeric code is accepted, in milliseconds: shorter than a link, since a code is easier to guess.
 *
 * @defaultValue 10 minutes.
 */
export const DEFAULT_CODE_TTL: number = 10 * 60 * 1000;

/**
 * How long the browser has to come back from an OAuth provider, in milliseconds.
 *
 * @defaultValue 10 minutes.
 */
export const DEFAULT_OAUTH_STATE_TTL: number = 10 * 60 * 1000;

/**
 * How long a JWT access token is accepted, in milliseconds. It cannot be revoked, so it is kept short.
 *
 * @defaultValue 15 minutes.
 */
export const DEFAULT_ACCESS_TOKEN_TTL: number = 15 * 60 * 1000;

/**
 * How long a refresh token is accepted, in milliseconds.
 *
 * @defaultValue 30 days.
 */
export const DEFAULT_REFRESH_TOKEN_TTL: number = 30 * 24 * 60 * 60 * 1000;

/**
 * The shortest secret accepted for signing or encrypting, in characters: 256 bits written as base64 are 43, as hex 64;
 * anything under 32 is not a random secret.
 *
 * @defaultValue 32
 */
export const MIN_SECRET_LENGTH = 32;

/**
 * Session lifetimes.
 */
export interface AuthSessionSettings {
	/** The hard lifetime, in milliseconds; {@link DEFAULT_SESSION_TTL} unless given. */
	ttl?: number | undefined;
	/**
	 * The idle lifetime, in milliseconds: a session unused for this long ends before its `ttl`, and each use pushes the
	 * deadline back. None unless given — the session then lasts its `ttl`.
	 */
	idleTtl?: number | undefined;
}

/**
 * JWT signing: a shared secret (`HS256`) or a key pair (`ES256`, `EdDSA`).
 */
export interface AuthJwtSettings {
	/** The algorithm; `HS256` with a `secret`, `ES256` with a key pair, unless given. */
	algorithm?: 'HS256' | 'ES256' | 'EdDSA' | undefined;
	/** The HMAC secret for `HS256`: at least 32 random bytes, in any encoding. */
	secret?: string | undefined;
	/** The PKCS#8 PEM private key for `ES256` / `EdDSA`. */
	privateKey?: string | undefined;
	/** The SPKI PEM public key matching `privateKey`. */
	publicKey?: string | undefined;
	/** The `iss` claim; checked on verify when given. */
	issuer?: string | undefined;
	/** The `aud` claim; checked on verify when given. */
	audience?: string | undefined;
	/** Access token lifetime, in milliseconds; {@link DEFAULT_ACCESS_TOKEN_TTL} unless given. */
	accessTtl?: number | undefined;
	/** Refresh token lifetime, in milliseconds; {@link DEFAULT_REFRESH_TOKEN_TTL} unless given. */
	refreshTtl?: number | undefined;
}

/**
 * TOTP settings.
 */
export interface AuthMfaSettings {
	/** The name authenticator apps show above the code: the application's name. */
	issuer?: string | undefined;
	/** The secret TOTP secrets are encrypted with at rest: at least 32 random bytes, in any encoding. */
	encryptionKey?: string | undefined;
}

/**
 * OAuth settings.
 */
export interface AuthOAuthSettings {
	/**
	 * The secret the OAuth cookie is encrypted with — it carries the state, the PKCE verifier and the nonce between
	 * `startOAuth()` and `finishOAuth()`: at least {@link MIN_SECRET_LENGTH} characters of random data.
	 */
	secret?: string | undefined;
	/** How long the browser has to come back, in milliseconds; {@link DEFAULT_OAUTH_STATE_TTL} unless given. */
	stateTtl?: number | undefined;
}

/**
 * Rate limiters of the guessable steps. Each is optional; without one, the step is not limited.
 */
export interface AuthLimiters {
	/** `signIn()`, keyed by location and identifier: slows password guessing against one account. */
	signIn?: LimiterDriver | undefined;
	/** TOTP and recovery codes, keyed by user. */
	mfa?: LimiterDriver | undefined;
	/** One-time numeric codes, keyed by purpose and user. */
	code?: LimiterDriver | undefined;
}

/**
 * Everything the functions of the package read from the application's configuration.
 *
 * Every field is optional; what is missing falls back to the defaults of this module, and the features that need a
 * secret — JWTs, TOTP, OAuth — refuse to run without it.
 */
export interface AuthSettings {
	/** Session lifetimes. */
	session?: AuthSessionSettings | undefined;
	/** One-time token lifetimes. */
	tokens?:
		| {
				/** Lifetime of a link token, in milliseconds; {@link DEFAULT_TOKEN_TTL} unless given. */
				ttl?: number | undefined;
				/** Lifetime of a numeric code, in milliseconds; {@link DEFAULT_CODE_TTL} unless given. */
				codeTtl?: number | undefined;
		  }
		| undefined;
	/** OAuth. */
	oauth?: AuthOAuthSettings | undefined;
	/** JWT access and refresh tokens. */
	jwt?: AuthJwtSettings | undefined;
	/** TOTP. */
	mfa?: AuthMfaSettings | undefined;
	/** Rate limiters. */
	limiters?: AuthLimiters | undefined;
}
