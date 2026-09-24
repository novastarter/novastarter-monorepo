import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { DEFAULT_ACCESS_TOKEN_TTL, DEFAULT_REFRESH_TOKEN_TTL } from '../../lib/settings.js';
import type { RefreshRecord } from '../../types.js';
import { hashToken, randomToken } from '../../utils/index.js';
import { jwtKeys } from './keys.js';

/**
 * The `typ` header of the access tokens: RFC 9068's access-token type, so an ID token or any other JWT signed with the
 * same key is not accepted as one.
 *
 * @defaultValue `at+jwt`
 */
export const ACCESS_TOKEN_TYPE = 'at+jwt';

/**
 * Claims the package sets itself; custom claims under these names are dropped.
 *
 * @internal
 */
const RESERVED_CLAIMS = new Set(['sub', 'iss', 'aud', 'exp', 'iat', 'nbf', 'jti']);

/**
 * Per-call options of {@link issueTokenPair}.
 */
export interface IssueTokenPairOptions {
	/** Extra claims of the access token: roles, the tenant. Signed, not encrypted — nothing secret. */
	claims?: Record<string, unknown> | undefined;
}

/**
 * A JWT access token and its refresh token.
 */
export interface TokenPair {
	/** The JWT for the `Authorization: Bearer` header. */
	accessToken: string;
	/** The opaque token that gets the next pair through `refreshTokenPair()`. Shown once: the record keeps its hash. */
	refreshToken: string;
	/** Seconds until the access token expires, as OAuth's `expires_in` has it. */
	expiresIn: number;
	/** When the refresh token expires, epoch milliseconds. */
	refreshExpiresAt: number;
}

/**
 * What {@link issueTokenPair} hands back.
 */
export interface IssuedTokenPair {
	/** The tokens for the client. */
	pair: TokenPair;
	/** The refresh token's record, for the application to store. */
	refresh: RefreshRecord;
}

/**
 * Sign an access token and make a refresh token of a family.
 *
 * @param userId - The user.
 * @param familyId - The refresh family: new at sign-in, the old one's on rotation.
 * @param claims - Extra claims of the access token.
 * @returns The pair and the refresh token's record.
 * @internal
 */
export const makeTokenPair = async (
	userId: string,
	familyId: string,
	claims: Record<string, unknown> = {},
): Promise<IssuedTokenPair> => {
	const keys = await jwtKeys();
	const now = Date.now();
	const accessTtl = keys.settings.accessTtl ?? DEFAULT_ACCESS_TOKEN_TTL;
	const refreshTtl = keys.settings.refreshTtl ?? DEFAULT_REFRESH_TOKEN_TTL;

	// Custom claims first, the registered ones over them, so no caller can forge a `sub` or stretch an `exp`
	const custom = Object.fromEntries(Object.entries(claims).filter(([name]) => !RESERVED_CLAIMS.has(name)));

	let jwt = new SignJWT(custom)
		.setProtectedHeader({ alg: keys.algorithm, typ: ACCESS_TOKEN_TYPE })
		.setSubject(userId)
		.setIssuedAt(Math.floor(now / 1000))
		.setExpirationTime(Math.floor((now + accessTtl) / 1000))
		.setJti(randomUUID());

	if (keys.settings.issuer) jwt = jwt.setIssuer(keys.settings.issuer);
	if (keys.settings.audience) jwt = jwt.setAudience(keys.settings.audience);

	// The refresh token is opaque and stateful: only a stored one refreshes, so it can be revoked
	const refreshToken = randomToken();

	const refresh: RefreshRecord = {
		id: hashToken(refreshToken),
		familyId,
		userId,
		createdAt: now,
		expiresAt: now + refreshTtl,
		usedAt: null,
	};

	return {
		pair: {
			accessToken: await jwt.sign(keys.signKey),
			refreshToken,
			expiresIn: Math.floor(accessTtl / 1000),
			refreshExpiresAt: refresh.expiresAt,
		},
		refresh,
	};
};

/**
 * Issue a JWT access token and a refresh token after sign-in — for a mobile app or an API client that cannot hold a
 * cookie; the application stores the refresh token's record.
 *
 * The access token is a signed JWT (`sub`, `exp`, `iat`, `jti`, `iss` and `aud` when configured, `typ: at+jwt`) that
 * `verifyAccessToken()` checks without any lookup; it cannot be revoked, so it is short-lived. The refresh token is
 * opaque, starts a new family, and is exchanged through `refreshTokenPair()`.
 *
 * @param userId - The user, in the application's own id format.
 * @param options - Extra claims of the access token.
 * @returns The pair for the client and the refresh record to store.
 * @throws InvalidConfigError when the JWT settings are missing or unusable.
 * @example
 * ```ts
 * const { pair, refresh } = await issueTokenPair(identity.subject, { claims: { role: 'admin' } });
 *
 * await db.insert(authRefreshTokens).values(refresh);
 * return Response.json(pair);
 * ```
 */
export const issueTokenPair = async (userId: string, options: IssueTokenPairOptions = {}): Promise<IssuedTokenPair> => {
	// A sign-in starts a family of its own, so revoking one device's chain leaves the others signed in
	return makeTokenPair(userId, randomUUID(), options.claims);
};
