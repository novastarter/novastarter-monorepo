import type { AuthorizeParams } from '@novastarter/auth';
import { AUTHORIZE_URL } from './constants.js';

/**
 * Build the URL of GitHub's consent page for one sign-in.
 *
 * The scopes of the call win over the location's. The PKCE challenge is always S256 — the only method `startOAuth()`
 * makes. GitHub is plain OAuth, not OpenID Connect: it issues no ID token, so the nonce has nowhere to go and is left
 * out; the state and PKCE bind the callback to this sign-in instead.
 *
 * @param params - State, PKCE challenge, redirect URI and the call's scopes.
 * @param clientId - The client id of the OAuth app.
 * @param scopes - The location's scopes, used when the call names none.
 * @returns The URL to send the browser to.
 * @example
 * ```ts
 * const url = buildAuthorizeUrl(params, 'Iv1.0123456789abcdef', ['read:user', 'user:email']);
 * ```
 */
export const buildAuthorizeUrl = (params: AuthorizeParams, clientId: string, scopes: readonly string[]): URL => {
	// `URLSearchParams` does the encoding, so a redirect URI with its own query survives intact; GitHub reads the
	// scopes space-separated like the OAuth spec
	const url = new URL(AUTHORIZE_URL);

	url.search = new URLSearchParams({
		client_id: clientId,
		redirect_uri: params.redirectUri,
		scope: (params.scopes ?? scopes).join(' '),
		state: params.state,
		code_challenge: params.codeChallenge,
		code_challenge_method: 'S256',
	}).toString();

	return url;
};
