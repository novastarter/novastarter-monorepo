import type { AuthorizeParams } from '@novastarter/auth';
import { AUTHORIZE_URL } from './constants.js';

/**
 * Build the URL of Google's consent page for one sign-in.
 *
 * The scopes of the call win over the location's; `openid` is added when they lack it, since the driver reads the
 * person from the ID token and Google only issues one for that scope. The PKCE challenge is always S256 — the only
 * method `startOAuth()` makes — and the nonce is bound into the ID token, which the callback checks.
 *
 * @param params - State, PKCE challenge, nonce, redirect URI and the call's scopes.
 * @param clientId - The OAuth client id of the location.
 * @param scopes - The location's scopes, used when the call names none.
 * @returns The URL to send the browser to.
 * @example
 * ```ts
 * const url = buildAuthorizeUrl(params, 'client-id.apps.googleusercontent.com', ['openid', 'email']);
 * ```
 */
export const buildAuthorizeUrl = (params: AuthorizeParams, clientId: string, scopes: readonly string[]): URL => {
	// `openid` leads when missing, or no ID token comes back
	const requested = params.scopes ?? scopes;
	const scope = requested.includes('openid') ? requested : ['openid', ...requested];

	// `URLSearchParams` does the encoding, so a redirect URI with its own query survives intact
	const url = new URL(AUTHORIZE_URL);

	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: params.redirectUri,
		scope: scope.join(' '),
		state: params.state,
		code_challenge: params.codeChallenge,
		code_challenge_method: 'S256',
		nonce: params.nonce,
	}).toString();

	return url;
};
