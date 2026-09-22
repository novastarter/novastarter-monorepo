import type { AuthIdentity, AuthorizeParams, CallbackParams, Credentials } from './types.js';

/**
 * Contract every sign-in driver implements: an OAuth provider (`authorize` + `callback`) or a form (`authenticate`).
 *
 * Declared as an ambient class rather than an interface so that `typeof AuthDriver` describes a constructor for
 * `AuthManager.registerDriver`; no runtime code exists behind it. Drivers live in `@novastarter/auth-driver-*`
 * packages. The constructor takes the `options` of the location that names the driver; the manager calls it on the
 * location's first use. A driver only proves who someone is: state, PKCE, rate limits and events are handled by
 * `startOAuth()`, `finishOAuth()` and `signIn()`, the same way for every provider.
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
	 * @param params - Code, PKCE verifier, nonce and redirect URI.
	 * @returns The identity.
	 * @throws AuthProviderFailedError when the provider refuses the code or its answer does not check out.
	 */
	callback?(params: CallbackParams): Promise<AuthIdentity>;

	/**
	 * Check what a person typed.
	 *
	 * @param credentials - Identifier and password.
	 * @returns The identity.
	 * @throws InvalidCredentialsError when they do not match.
	 */
	authenticate?(credentials: Credentials): Promise<AuthIdentity>;

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
