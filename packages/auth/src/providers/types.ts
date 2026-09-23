/**
 * Who a sign-in driver says the person is, in the same shape for every provider.
 *
 * The application maps it to a user of its own — finds the account linked to `provider` + `subject`, links or creates
 * one — since which identities belong together is its business, not the package's.
 */
export interface AuthIdentity {
	/** The driver's provider: `google`, `github`, `credentials`. */
	provider: string;
	/** The provider's stable id of the person; for `credentials`, the application's user id. */
	subject: string;
	/** The email address, when the provider shares one. */
	email?: string | undefined;
	/** Whether the provider vouches for the address; an unverified one must not be used to link accounts. */
	emailVerified?: boolean | undefined;
	/** The display name, when the provider shares one. */
	name?: string | undefined;
	/** The avatar URL, when the provider has one. */
	avatarUrl?: string | undefined;
	/** The provider's own profile, for fields this shape does not carry. */
	raw?: unknown;
}

/**
 * What an OAuth driver needs to build the URL it sends the browser to.
 */
export interface AuthorizeParams {
	/** Opaque value the provider hands back to the callback; ties the callback to this browser. */
	state: string;
	/** PKCE challenge: the base64url SHA-256 of the verifier kept on the server. */
	codeChallenge: string;
	/** OpenID Connect nonce, bound into the ID token, for providers that issue one. */
	nonce: string;
	/** Where the provider sends the browser back to; must match the URL registered with the provider. */
	redirectUri: string;
	/** Scopes to ask for instead of the driver's defaults. */
	scopes?: string[] | undefined;
}

/**
 * What an OAuth driver needs to finish a sign-in from the callback.
 */
export interface CallbackParams {
	/** The authorization code from the callback's query or form. */
	code: string;
	/** PKCE verifier kept since the authorization began. */
	codeVerifier: string;
	/** The nonce sent with the authorization, for checking the ID token. */
	nonce: string;
	/** The redirect URI sent with the authorization; the token exchange must repeat it. */
	redirectUri: string;
}

/**
 * What a person types into a sign-in form.
 */
export interface Credentials {
	/** Email address, user name or whatever else the application signs in by. */
	identifier: string;
	/** The password, as typed. */
	password: string;
}

/**
 * What the browser sends to either step of a two-step sign-in — an email to send a link to, a code, a passkey's
 * signed answer — as the driver of the location reads it.
 *
 * `identifier`, when present, is what the `signIn` limiter is keyed by at the start, so one address cannot be flooded
 * with links.
 */
export type ChallengeInput = Record<string, unknown> & {
	/** Email address or whatever else the step is about; keys the rate limit of the start. */
	identifier?: string | undefined;
};

/**
 * What a driver answers the first step of a two-step sign-in with.
 */
export interface ChallengeBegun {
	/** What the browser needs for the second step — a passkey's request options; nothing for a link sent by mail. */
	options?: unknown;
	/**
	 * What the driver needs back at the second step — a passkey's challenge. It travels in an encrypted cookie, so the
	 * browser can neither read nor change it; nothing is stored on the server.
	 */
	state?: Record<string, unknown> | undefined;
}
