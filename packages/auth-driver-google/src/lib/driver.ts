import {
	type AuthCallOptions,
	type AuthDriver,
	type AuthorizeParams,
	AuthProviderFailedError,
	type CallbackParams,
	type OAuthCallbackResult,
} from '@novastarter/auth';
import { toProviderCallError } from '@novastarter/errors';
import { MAX_TIMER_DELAY, parseCallMethod } from '@novastarter/utils';
import { httpCall, resolveCallUrl } from '@novastarter/utils/node';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { buildAuthorizeUrl } from './build-authorize-url.js';
import { API_URL, CALL_HOSTS, DEFAULT_SCOPES, DEFAULT_TIMEOUT, JWKS_URL, PROVIDER } from './constants.js';
import { describeRefusal } from './describe-refusal.js';
import { exchangeCode } from './exchange-code.js';
import { type AuthFetch, request, type RequestContext, toHttpCallFetch } from './request.js';
import { toIdentity } from './to-identity.js';
import { verifyIdToken } from './verify-id-token.js';

/**
 * Options accepted by {@link AuthDriverGoogle}.
 */
export type AuthDriverGoogleConfig = {
	/** OAuth client id from the Google Cloud console (`….apps.googleusercontent.com`). */
	clientId: string;
	/** OAuth client secret of that client. */
	clientSecret: string;
	/** Scopes to ask for; `openid email profile` unless given. `openid` is always added. */
	scopes?: string[] | undefined;
	/** How long one request to Google may take, in milliseconds; 10 s unless given. */
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
	/**
	 * Keys to verify ID tokens with instead of Google's remote set — tests hand in a local one.
	 *
	 * @internal
	 */
	jwks?: JWTVerifyGetKey | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/auth`, so a location naming `google` has its options
 * checked against {@link AuthDriverGoogleConfig}.
 */
declare module '@novastarter/auth' {
	interface AuthDrivers {
		google: AuthDriverGoogleConfig;
	}
}

/**
 * Sign-in driver for [Google](https://developers.google.com/identity/openid-connect/openid-connect), over OpenID
 * Connect.
 *
 * The person is read from the ID token of the code exchange, verified against Google's published keys, so no profile
 * request follows. State, PKCE and the nonce are made by `startOAuth()`; the driver builds the consent URL and checks
 * what comes back. The access token of the exchange is handed on to `finishOAuth()`, and any of Google's APIs is
 * reachable with it through {@link AuthDriverGoogle.call}.
 *
 * @example
 * ```ts
 * import { useAuth } from '@novastarter/auth';
 * import { AuthDriverGoogle } from '@novastarter/auth-driver-google';
 * import { env } from './env';
 *
 * const auth = useAuth();
 *
 * auth.registerDriver('google', AuthDriverGoogle);
 * auth.registerLocation('google', {
 * 	driver: 'google',
 * 	options: {
 * 		clientId: env.AUTH_GOOGLE_CLIENT_ID,
 * 		clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
 * 	},
 * });
 * ```
 */
export class AuthDriverGoogle implements AuthDriver {
	/**
	 * The OAuth client id: sent with the authorization and the audience every ID token must name.
	 *
	 * @internal
	 */
	private readonly clientId: string;

	/**
	 * The OAuth client secret, sent with the code exchange.
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
	 * The keys ID tokens are verified with; Google's remote set, fetched on first use and cached by `jose`.
	 *
	 * @internal
	 */
	private readonly jwks: JWTVerifyGetKey;

	/**
	 * Create a driver for one OAuth client.
	 *
	 * @param config - Client credentials, scopes and timeout.
	 * @throws Error without a client id or secret.
	 * @throws RangeError for a timeout that is not a whole number from 1 to `MAX_TIMER_DELAY` — refused here, at the
	 * location's first use, rather than on a sign-in.
	 */
	constructor(config: AuthDriverGoogleConfig) {
		// 1. Missing credentials are a configuration error; report them by the option's name
		if (!config.clientId) {
			throw new Error('The google auth driver needs a "clientId"');
		}

		if (!config.clientSecret) {
			throw new Error('The google auth driver needs a "clientSecret"');
		}

		// 2. A timeout a timer cannot hold would fail every request at once instead of never, so it is refused now
		const timeout = config.timeout ?? DEFAULT_TIMEOUT;

		if (!(Number.isInteger(timeout) && timeout >= 1 && timeout <= MAX_TIMER_DELAY)) {
			throw new RangeError(
				`The google auth driver needs a "timeout" between 1 and ${MAX_TIMER_DELAY} ms, got ${config.timeout}`,
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

		// 4. The remote set is lazy — nothing is fetched until the first token — and `jose` caches it and refetches on
		//    an unknown `kid`, which is how Google's key rotation is followed; the same deadline bounds its fetch
		this.jwks = config.jwks ?? createRemoteJWKSet(new URL(JWKS_URL), { timeoutDuration: timeout });
	}

	/**
	 * Build the URL of Google's consent page.
	 *
	 * @param params - State, PKCE challenge, nonce, redirect URI and scopes, as `startOAuth()` makes them.
	 * @returns The URL to redirect the browser to.
	 */
	async authorize(params: AuthorizeParams): Promise<URL> {
		// 1. Nothing to ask Google yet: the URL is built from the parameters alone
		return buildAuthorizeUrl(params, this.clientId, this.scopes);
	}

	/**
	 * Exchange the callback's code and read the person from the verified ID token.
	 *
	 * @param params - Code, PKCE verifier, nonce and redirect URI, as `finishOAuth()` passes them.
	 * @returns The identity: Google's `sub` as the subject, the address, whether Google verified it, the name and
	 * the picture; and under `tokens` the access token with its expiry and granted scopes, and the refresh token when
	 * the consent asked for offline access.
	 * @throws AuthProviderFailedError when Google refuses the code, or the ID token fails a check.
	 */
	async callback(params: CallbackParams): Promise<OAuthCallbackResult> {
		// 1. The code, bound to this sign-in by the PKCE verifier, buys the ID token and the access token
		const { idToken, tokens } = await exchangeCode(this.context, {
			code: params.code,
			codeVerifier: params.codeVerifier,
			redirectUri: params.redirectUri,
			clientId: this.clientId,
			clientSecret: this.clientSecret,
		});

		// 2. The token is only trusted once its signature, audience and nonce check out
		const claims = await verifyIdToken(idToken, { jwks: this.jwks, audience: this.clientId, nonce: params.nonce });

		// 3. The tokens go back with the identity; `finishOAuth()` takes them off before anything else sees it, and
		//    keeping them is the application's call
		return { ...toIdentity(claims), ...(tokens ? { tokens } : {}) };
	}

	/**
	 * Make a request of one of Google's APIs, on behalf of a person or without credentials.
	 *
	 * With `options.accessToken` the request carries it as a Bearer token and acts as that person — within the scopes
	 * they granted. Without it no `Authorization` goes out: for the endpoints that need none, or take an API key the
	 * caller passes as the `key` parameter. The caller's headers go on top. The parameters are the query of a `GET`,
	 * `HEAD` or `DELETE` and the JSON body otherwise.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from Google's documentation.
	 * @param method - The verb and the path from `https://www.googleapis.com`, or a full URL on a `googleapis.com`
	 * host — `https://people.googleapis.com/v1/people/me`.
	 * @param params - Its query or body.
	 * @param options - The person's access token, a timeout (the location's unless given), an abort signal, extra
	 * headers, where the parameters go (`paramsIn`).
	 * @returns Google's answer: parsed JSON, else text; `undefined` for an empty one — a `204`.
	 * @throws ProviderCallError when Google answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Google answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on a `googleapis.com` host.
	 * @example
	 * ```ts
	 * const calendars = await useAuth()
	 * 	.location('google')
	 * 	.call?.('GET /calendar/v3/users/me/calendarList', { maxResults: 50 }, { accessToken: tokens.accessToken });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params: Record<string, unknown> = {},
		options: AuthCallOptions = {},
	): Promise<T> {
		// 1. The method taken apart and its URL checked against Google's hosts before the token goes near it
		const { verb, target } = parseCallMethod(method);
		const url = resolveCallUrl(API_URL, target, CALL_HOSTS);

		// 2. The request under the caller's deadline or the location's, with the person's token when there is one; the
		//    driver's fetch is the one tests replace, and it answers what `httpCall` reads of a response
		const response = await httpCall({
			url,
			verb,
			params,
			paramsIn: options.paramsIn,
			headers: {
				...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
				...options.headers,
			},
			timeout: options.timeout ?? this.context.timeout,
			signal: options.signal,
			fetch: toHttpCallFetch(this.context.fetch),
		});

		// 3. A status outside 2xx becomes the kit's error; its message names the method and Google's reason, never the
		//    token, which stays in the request
		if (response.status < 200 || response.status >= 300) {
			throw toProviderCallError({
				provider: PROVIDER,
				method,
				status: response.status,
				body: response.body,
				headers: response.headers,
			});
		}

		return response.body as T;
	}

	/**
	 * Check Google's key set can be reached, without signing anyone in.
	 *
	 * The client secret cannot be checked without a code to exchange, so this proves connectivity only.
	 *
	 * @throws AuthProviderFailedError when the key set cannot be read.
	 */
	async verify(): Promise<void> {
		// 1. The key set is what every callback needs first; a set without keys would verify nothing
		const response = await request(this.context, JWKS_URL, { method: 'GET', headers: { Accept: 'application/json' } });
		const keys = (response.body as { keys?: unknown } | undefined)?.keys;

		if (!response.ok || !Array.isArray(keys) || keys.length === 0) {
			throw new AuthProviderFailedError(
				{
					provider: PROVIDER,
					reason: response.ok ? 'the key set has no keys' : describeRefusal('the key set', response),
				},
				{ cause: response.body },
			);
		}
	}
}
