import type {
	AuthCallOptions,
	AuthDriver,
	AuthorizeParams,
	CallbackParams,
	OAuthCallbackResult,
} from '@novastarter/auth';
import { toProviderCallError } from '@novastarter/errors';
import { type CallResponse, type HttpApi, type HttpCallResponse, request } from '@novastarter/http';
import { MAX_TIMER_DELAY } from '@novastarter/utils';
import { buildAuthorizeUrl } from './build-authorize-url.js';
import {
	API_URL,
	API_VERSION,
	CALL_HOSTS,
	DEFAULT_SCOPES,
	DEFAULT_TIMEOUT,
	PROVIDER,
	USER_AGENT,
} from './constants.js';
import { exchangeCode } from './exchange-code.js';
import { fetchProfile } from './fetch-profile.js';
import { githubRateLimitWait } from './rate-limit.js';
import { type AuthFetch, type RequestContext, toHttpCallFetch } from './request.js';
import { toIdentity } from './to-identity.js';

/**
 * Options accepted by {@link AuthDriverGithub}.
 */
export type AuthDriverGithubConfig = {
	/** Client id of the OAuth app (or GitHub App) from GitHub's developer settings. */
	clientId: string;
	/** Client secret of that app. */
	clientSecret: string;
	/** Scopes to ask for; `read:user user:email` unless given. */
	scopes?: string[] | undefined;
	/** How long one request to GitHub may take, in milliseconds; 10 s unless given. */
	timeout?: number | undefined;
	/**
	 * A fetch to send with instead of the platform's — tests hand in a fake.
	 *
	 * `call()` passes it `redirect: 'manual'` and may pass a `FormData` body, though the type names neither: a custom
	 * fetch must forward the whole request to the real one, `redirect` included, or credentials could follow a
	 * redirect to another host.
	 *
	 * @internal
	 */
	fetch?: AuthFetch | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/auth`, so a location naming `github` has its options
 * checked against {@link AuthDriverGithubConfig}.
 */
declare module '@novastarter/auth' {
	interface AuthDrivers {
		github: AuthDriverGithubConfig;
	}
}

/**
 * Sign-in driver for [GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
 *
 * GitHub is plain OAuth: the code buys an access token, and the person is read from the REST API — the profile for the
 * id and the name, the address list for the primary verified address. State and PKCE are made by `startOAuth()`; the
 * driver builds the consent URL and runs the requests. The token is handed on to `finishOAuth()`, and any other request
 * of the REST API goes through {@link AuthDriverGithub.call}.
 *
 * @example
 * ```ts
 * import { useAuth } from '@novastarter/auth';
 * import { AuthDriverGithub } from '@novastarter/auth-driver-github';
 * import { env } from './env';
 *
 * const auth = useAuth();
 *
 * auth.registerDriver('github', AuthDriverGithub);
 * auth.registerLocation('github', {
 * 	driver: 'github',
 * 	options: {
 * 		clientId: env.AUTH_GITHUB_CLIENT_ID,
 * 		clientSecret: env.AUTH_GITHUB_CLIENT_SECRET,
 * 	},
 * });
 * ```
 */
export class AuthDriverGithub implements AuthDriver {
	/**
	 * The client id of the app, sent with the authorization and the exchange.
	 *
	 * @internal
	 */
	private readonly clientId: string;

	/**
	 * The client secret of the app, sent with the exchange.
	 *
	 * @internal
	 */
	private readonly clientSecret: string;

	/**
	 * The location's scopes, used when a call names none.
	 *
	 * @internal
	 */
	private readonly scopes: readonly string[];

	/**
	 * The fetch and the deadline every request is sent with.
	 *
	 * @internal
	 */
	private readonly context: RequestContext;

	/**
	 * Create a driver for one OAuth app.
	 *
	 * @param config - App credentials, scopes and timeout.
	 * @throws Error without a client id or secret.
	 * @throws RangeError for a timeout that is not a whole number from 1 to `MAX_TIMER_DELAY` — refused here, at the
	 * location's first use, rather than on a sign-in.
	 */
	constructor(config: AuthDriverGithubConfig) {
		// 1. Missing credentials are a configuration error; report them by the option's name
		if (!config.clientId) {
			throw new Error('The github auth driver needs a "clientId"');
		}

		if (!config.clientSecret) {
			throw new Error('The github auth driver needs a "clientSecret"');
		}

		// 2. A timeout a timer cannot hold would fail every request at once instead of never, so it is refused now
		const timeout = config.timeout ?? DEFAULT_TIMEOUT;

		if (!(Number.isInteger(timeout) && timeout >= 1 && timeout <= MAX_TIMER_DELAY)) {
			throw new RangeError(
				`The github auth driver needs a "timeout" between 1 and ${MAX_TIMER_DELAY} ms, got ${config.timeout}`,
			);
		}

		this.clientId = config.clientId;
		this.clientSecret = config.clientSecret;
		this.scopes = config.scopes ?? DEFAULT_SCOPES;

		// 3. The platform's fetch unless a test hands in its own, bound to the global object: `fetch` throws
		//    `Illegal invocation` on some runtimes when called with another receiver, which `context.fetch(...)` is
		this.context = {
			fetch: config.fetch ?? (globalThis.fetch.bind(globalThis) as unknown as AuthFetch),
			timeout,
		};
	}

	/**
	 * Build the URL of GitHub's consent page.
	 *
	 * @param params - State, PKCE challenge, redirect URI and scopes, as `startOAuth()` makes them; the nonce is not
	 * used, as GitHub issues no ID token.
	 * @returns The URL to redirect the browser to.
	 */
	async authorize(params: AuthorizeParams): Promise<URL> {
		// 1. Nothing to ask GitHub yet: the URL is built from the parameters alone
		return buildAuthorizeUrl(params, this.clientId, this.scopes);
	}

	/**
	 * Exchange the callback's code and read the person from the REST API.
	 *
	 * @param params - Code, PKCE verifier and redirect URI, as `finishOAuth()` passes them.
	 * @returns The identity: the numeric id as the subject, the primary verified address, the name (or the login) and
	 * the avatar; and under `tokens` the access token with the scopes granted, and the refresh token and expiry of an
	 * expiring one.
	 * @throws AuthProviderFailedError when GitHub refuses the code, or a profile request fails.
	 */
	async callback(params: CallbackParams): Promise<OAuthCallbackResult> {
		// 1. The code, bound to this sign-in by the PKCE verifier, buys the tokens
		const tokens = await exchangeCode(this.context, {
			code: params.code,
			codeVerifier: params.codeVerifier,
			redirectUri: params.redirectUri,
			clientId: this.clientId,
			clientSecret: this.clientSecret,
		});

		// 2. The access token reads who signed in, then goes back with the identity; `finishOAuth()` takes it off before
		//    anything else sees the identity, and keeping it is the application's call
		return { ...toIdentity(await fetchProfile(this.context, tokens.accessToken)), tokens };
	}

	/**
	 * Make a request of GitHub's REST API, on behalf of a person or as the app.
	 *
	 * With `options.accessToken` the request carries it as a Bearer token and acts as that person — within the scopes
	 * they granted. Without it the request is authenticated as the OAuth app, with Basic `clientId:clientSecret`: what
	 * GitHub's `/applications/{client_id}/…` endpoints take — checking, resetting or revoking a token — with
	 * `{client_id}` in the method replaced by the app's client id. Any other `{name}` in the method is filled from the
	 * parameter of that name — `{owner}` and `{repo}` of `/repos/{owner}/{repo}` — which is then not sent again. Every
	 * request pins the API version and carries
	 * GitHub's media type and a user agent; the caller's headers go on top. The parameters are the query of a `GET`,
	 * `HEAD` or `DELETE` and the JSON body otherwise.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from GitHub's documentation.
	 * @param method - The verb and the path from `https://api.github.com`, or a full URL on `api.github.com` or
	 * `uploads.github.com`.
	 * @param params - Its query or body.
	 * @param options - The person's access token, a timeout (the location's unless given), an abort signal, extra
	 * headers.
	 * @returns The status, the headers — the `link` to the next page, the `x-ratelimit-*` budget — and GitHub's answer:
	 * parsed JSON, else text; `undefined` for an empty one — a `204`.
	 * @throws ProviderCallError when GitHub answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when GitHub refuses for a rate limit: a 429, or a 403 with its limit spent
	 * (`x-ratelimit-remaining: 0`, reset at `x-ratelimit-reset`) or a `Retry-After`.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, a placeholder is left unfilled or its URL is not on GitHub's hosts.
	 * @example
	 * ```ts
	 * const github = useAuth().location('github');
	 *
	 * const { data: repos } = await github.call!('GET /user/repos', { per_page: 100 }, { accessToken });
	 * const { status } = await github.call!('POST /applications/{client_id}/token', { access_token: accessToken });
	 * const { data, headers } = await github.call!('GET /repos/{owner}/{repo}/issues', { owner: 'acme', repo: 'web' });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options: AuthCallOptions = {},
	): Promise<CallResponse<T>> {
		// 1. The app's client id put in for the placeholder of GitHub's app endpoints first — the Basic credentials are
		//    this app's, so no parameter names another one; the token stays out of the options handed on, so it is
		//    never sent as a header of its own
		const { accessToken, ...rest } = options;

		return request<T>(
			this.api(accessToken),
			method.replaceAll('{client_id}', encodeURIComponent(this.clientId)),
			params,
			rest,
		);
	}

	/**
	 * GitHub's REST API as {@link AuthDriverGithub.call} requests it: on GitHub's hosts only, with the headers every
	 * GitHub REST client sends, under the location's deadline, through the driver's fetch, and GitHub's rate limits
	 * read as such.
	 *
	 * @param accessToken - The person's token; the app's Basic credentials without one.
	 * @returns The API description for `request()`.
	 * @internal
	 */
	private api(accessToken: string | undefined): HttpApi {
		// 1. The person's token when the caller has one, the app's own credentials otherwise — so the API is built per
		//    call
		const authorization = accessToken
			? `Bearer ${accessToken}`
			: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;

		return {
			provider: PROVIDER,
			baseUrl: API_URL,
			hosts: CALL_HOSTS,
			headers: {
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': API_VERSION,
				'User-Agent': USER_AGENT,
				Authorization: authorization,
			},
			timeout: this.context.timeout,
			fetch: toHttpCallFetch(this.context.fetch),
			refuse: refuseRateLimit,
		};
	}
}

/**
 * Read GitHub's rate limits — a 403 as often as a 429 — as a 429 with GitHub's wait, so the caller gets a
 * `HitRateLimitError` either way; a 403 that is a missing permission is left to the generic mapping.
 *
 * @param response - GitHub's answer.
 * @param method - The call's method, for the error.
 * @returns The rate-limit error, or `undefined` when the answer is not a rate limit.
 * @internal
 */
const refuseRateLimit = (response: HttpCallResponse, method: string): Error | undefined => {
	// 1. The wait GitHub names, if the refusal is a rate limit at all
	const wait = githubRateLimitWait(response.status, response.headers, response.body);

	if (wait === undefined) return undefined;

	// 2. The kit's error names the method and GitHub's reason, never the credentials, which stay in the request
	return toProviderCallError({
		provider: PROVIDER,
		method,
		status: 429,
		body: response.body,
		headers: response.headers,
		retryAfter: wait,
	});
};
