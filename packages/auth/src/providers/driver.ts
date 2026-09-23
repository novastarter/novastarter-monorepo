import type {
	AuthCallOptions,
	AuthIdentity,
	AuthorizeParams,
	CallbackParams,
	ChallengeBegun,
	ChallengeInput,
	Credentials,
	OAuthCallbackResult,
} from './types.js';

/**
 * Contract every sign-in driver implements: an OAuth provider (`authorize` + `callback`), a form (`authenticate`) or a
 * two-step challenge (`begin` + `complete`), such as a link sent by mail or a passkey.
 *
 * Declared as an ambient class rather than an interface so that `typeof AuthDriver` describes a constructor for
 * `AuthManager.registerDriver`; no runtime code exists behind it. Drivers live in `@novastarter/auth-driver-*`
 * packages. The constructor takes the `options` of the location that names the driver; the manager calls it on the
 * location's first use. A driver only proves who someone is: state, PKCE, rate limits and events are handled by
 * `startOAuth()`, `finishOAuth()`, `signIn()`, `startChallenge()` and `finishChallenge()`, the same way for every
 * provider.
 */
export declare class AuthDriver {
	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Driver-specific options, as given in the location's `options`.
	 */
	constructor(config: Record<string, unknown>);

	/**
	 * Build the URL of the provider's consent page.
	 *
	 * @param params - State, PKCE challenge, nonce and redirect URI.
	 * @returns The URL to redirect the browser to.
	 */
	authorize?(params: AuthorizeParams): Promise<URL>;

	/**
	 * Exchange the callback's code for the person's identity.
	 *
	 * The tokens the provider issued may come along under `tokens`; `finishOAuth()` takes them off before the identity
	 * passes the filter or an event, and hands them to the application.
	 *
	 * @param params - Code, PKCE verifier, nonce and redirect URI.
	 * @returns The identity, and the provider's tokens when the driver hands them on.
	 * @throws AuthProviderFailedError when the provider refuses the code or its answer does not check out.
	 */
	callback?(params: CallbackParams): Promise<OAuthCallbackResult>;

	/**
	 * Check what a person typed.
	 *
	 * @param credentials - Identifier and password.
	 * @returns The identity.
	 * @throws InvalidCredentialsError when they do not match.
	 */
	authenticate?(credentials: Credentials): Promise<AuthIdentity>;

	/**
	 * Start a two-step sign-in: send a link or a code, or make a passkey's challenge.
	 *
	 * @param input - What the browser sent: an email address, the format wanted.
	 * @returns The options for the browser, and the state to get back at {@link complete}.
	 * @throws InvalidPayloadError when the input is not one the driver can start from.
	 */
	begin?(input: ChallengeInput): Promise<ChallengeBegun>;

	/**
	 * Finish a two-step sign-in with what the browser sent back.
	 *
	 * @param input - What the browser sent: the token of a link, a code, a passkey's signed answer.
	 * @param state - The state {@link begin} returned, opened from its cookie; `undefined` without a cookie — a link
	 * opened in another browser than the one that asked for it.
	 * @returns The identity.
	 * @throws InvalidCredentialsError or AuthInvalidTokenError when the answer does not check out.
	 */
	complete?(input: ChallengeInput, state: Record<string, unknown> | undefined): Promise<AuthIdentity>;

	/**
	 * Make a request of the sign-in provider's own API with the location's credentials, timeout and errors — the way to
	 * whatever the contract does not cover: the person's repositories, calendar or contacts, revoking a token.
	 *
	 * The signature is the same for every driver; what `method` means is the provider's, so code calling it is written
	 * for one provider: the verb and path of a REST API — GitHub's `GET /user/repos`, Google's
	 * `GET /calendar/v3/users/me/calendarList` — or a full URL on one of the provider's own hosts. With
	 * `options.accessToken` the request is made on behalf of that person; without it, with the app's own credentials
	 * where the provider allows that. The parameters are the query of a `GET`, `HEAD` or `DELETE` and the body
	 * otherwise.
	 *
	 * Optional: a driver whose provider has no API beyond the sign-in — a form, a link sent by mail — leaves it out.
	 *
	 * @typeParam T - What the request answers with; the caller knows it from the provider's documentation.
	 * @param method - The verb and path, or a full URL on the provider's hosts.
	 * @param params - Its query or body.
	 * @param options - The person's access token, a timeout, an abort signal, extra headers, and `paramsIn`.
	 * @returns The provider's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError when the provider answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when the provider asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on the provider's hosts.
	 * @example
	 * ```ts
	 * const repos = await useAuth().location('github').call?.('GET /user/repos', { per_page: 100 }, {
	 * 	accessToken: tokens.accessToken,
	 * });
	 * ```
	 */
	call?<T = unknown>(method: string, params?: Record<string, unknown>, options?: AuthCallOptions): Promise<T>;

	/**
	 * Check the driver can be used — credentials, connectivity — without signing anyone in.
	 *
	 * @throws When it cannot.
	 */
	verify?(): Promise<void>;

	/**
	 * Release what the driver holds, so the process can exit.
	 *
	 * Optional: a driver that only makes HTTP requests has nothing to release. The manager calls it at shutdown.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}
