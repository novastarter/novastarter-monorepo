/**
 * Public entry point of `@novastarter/auth`.
 *
 * The building blocks of authentication as an API: everything is made, signed, hashed and checked here, and nothing
 * is stored — the application keeps the records these functions hand back, in its own tables, and hands them in again.
 *
 * - `providers`: the `AuthDriver` contract of the `@novastarter/auth-driver-*` packages and `signIn()`,
 *   `startOAuth()`, `finishOAuth()`, `startChallenge()`, `finishChallenge()`, on the `AuthManager` of `useAuth()`;
 * - `sessions`, `passwords`, `tokens` (one-time and JWT) and `mfa` (TOTP and recovery codes).
 *
 * The application registers the drivers, the locations and the settings at start-up; the package reads nothing from
 * the environment and knows nothing of the application's users beyond an id.
 */
export {
	AuthInvalidTokenError,
	AuthProviderFailedError,
	type AuthProviderFailedErrorExtensions,
} from './errors/index.js';
export { type AuthDrivers, AuthManager } from './lib/auth-manager.js';
export {
	type AuthChallengeSettings,
	type AuthJwtSettings,
	type AuthLimiters,
	type AuthMfaSettings,
	type AuthOAuthSettings,
	type AuthSessionSettings,
	type AuthSettings,
	DEFAULT_ACCESS_TOKEN_TTL,
	DEFAULT_CHALLENGE_TTL,
	DEFAULT_CODE_TTL,
	DEFAULT_OAUTH_STATE_TTL,
	DEFAULT_REFRESH_TOKEN_TTL,
	DEFAULT_SESSION_TTL,
	DEFAULT_TOKEN_TTL,
	MIN_SECRET_LENGTH,
} from './lib/settings.js';
export { useAuth } from './lib/use-auth.js';
export {
	enrollTotp,
	type EnrollTotpOptions,
	generateRecoveryCodes,
	isTotpCode,
	RECOVERY_CODE_COUNT,
	recoveryCodeId,
	type RecoveryCodes,
	reencryptTotpSecret,
	TOTP_DIGITS,
	TOTP_PERIOD,
	TOTP_SECRET_BYTES,
	TOTP_WINDOW,
	type TotpEnrolment,
	verifyRecoveryCode,
	type VerifyRecoveryCodeOptions,
	verifyTotp,
	type VerifyTotpOptions,
} from './mfa/index.js';
export {
	DEFAULT_SCRYPT_PARAMS,
	hashPassword,
	MAX_PASSWORD_LENGTH,
	needsRehash,
	type ScryptParams,
	verifyPassword,
} from './passwords/index.js';
export {
	AUTH_SIGN_IN_FAILED_EVENT,
	AUTH_SIGN_IN_FILTER,
	AUTH_SIGNED_IN_EVENT,
	type AuthCallOptions,
	type AuthDriver,
	type AuthIdentity,
	type AuthorizeParams,
	type CallbackParams,
	CHALLENGE_SIGN_IN_PURPOSE,
	type ChallengeBegun,
	type ChallengeInput,
	type Credentials,
	finishChallenge,
	type FinishChallengeParams,
	type FinishedOAuth,
	finishOAuth,
	type FinishOAuthParams,
	type OAuthCallbackResult,
	type OAuthTokens,
	openChallenge,
	sealChallenge,
	type SealedChallenge,
	signIn,
	startChallenge,
	type StartedChallenge,
	type StartedOAuth,
	startOAuth,
	type StartOAuthOptions,
} from './providers/index.js';
export {
	checkSession,
	type CreatedSession,
	createSession,
	type CreateSessionOptions,
	type SessionCheck,
} from './sessions/index.js';
export {
	ACCESS_TOKEN_TYPE,
	checkToken,
	type CheckTokenOptions,
	CODE_DIGITS,
	type CreatedToken,
	createToken,
	type CreateTokenOptions,
	type IssuedTokenPair,
	issueTokenPair,
	type IssueTokenPairOptions,
	oneTimeTokenId,
	type RefreshedTokenPair,
	refreshTokenPair,
	type RefreshTokenPairOptions,
	type TokenFormat,
	type TokenPair,
	type VerifiedAccessToken,
	verifyAccessToken,
} from './tokens/index.js';
export { type RefreshRecord, type SessionRecord, type TokenRecord } from './types.js';
export { hashToken } from './utils/hash-token.js';
