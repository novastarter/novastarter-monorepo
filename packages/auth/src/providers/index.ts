/**
 * Sign-in: the `AuthDriver` contract the `@novastarter/auth-driver-*` packages implement, the identity they return,
 * and the functions that run a sign-in through them.
 */
export type { AuthDriver } from './driver.js';
export {
	CHALLENGE_SIGN_IN_PURPOSE,
	finishChallenge,
	type FinishChallengeParams,
	openChallenge,
	sealChallenge,
	type SealedChallenge,
	startChallenge,
	type StartedChallenge,
} from './lib/challenge.js';
export { AUTH_SIGN_IN_FAILED_EVENT, AUTH_SIGN_IN_FILTER, AUTH_SIGNED_IN_EVENT } from './lib/events.js';
export {
	type FinishedOAuth,
	finishOAuth,
	type FinishOAuthParams,
	type StartedOAuth,
	startOAuth,
	type StartOAuthOptions,
} from './lib/oauth.js';
export { signIn } from './lib/sign-in.js';
export {
	type AuthCallOptions,
	type AuthIdentity,
	type AuthorizeParams,
	type CallbackParams,
	type ChallengeBegun,
	type ChallengeInput,
	type Credentials,
	type OAuthCallbackResult,
	type OAuthTokens,
} from './types.js';
