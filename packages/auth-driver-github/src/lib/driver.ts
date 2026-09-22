import type { AuthDriver, AuthIdentity, AuthorizeParams, CallbackParams } from '@novastarter/auth';
import { MAX_TIMER_DELAY } from '@novastarter/utils';
import { buildAuthorizeUrl } from './build-authorize-url.js';
import { DEFAULT_SCOPES, DEFAULT_TIMEOUT } from './constants.js';
import { exchangeCode } from './exchange-code.js';
import { fetchProfile } from './fetch-profile.js';
import type { AuthFetch, RequestContext } from './request.js';
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
 * driver builds the consent URL and runs the requests.
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
	 * the avatar.
	 * @throws AuthProviderFailedError when GitHub refuses the code, or a profile request fails.
	 */
	async callback(params: CallbackParams): Promise<AuthIdentity> {
		// 1. The code, bound to this sign-in by the PKCE verifier, buys an access token
		const accessToken = await exchangeCode(this.context, {
			code: params.code,
			codeVerifier: params.codeVerifier,
			redirectUri: params.redirectUri,
			clientId: this.clientId,
			clientSecret: this.clientSecret,
		});

		// 2. The token is only used to read who signed in; it is not kept
		return toIdentity(await fetchProfile(this.context, accessToken));
	}
}
