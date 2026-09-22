import { AuthProviderFailedError } from '@novastarter/auth';
import { PROVIDER, TOKEN_URL } from './constants.js';
import { describeRefusal } from './describe-refusal.js';
import { request, type RequestContext } from './request.js';

/**
 * What the token exchange needs: the callback's code, the PKCE verifier and the client's credentials.
 */
export interface ExchangeCodeParams {
	/** The authorization code from the callback. */
	code: string;
	/** The PKCE verifier kept since the authorization began. */
	codeVerifier: string;
	/** The redirect URI sent with the authorization; Google refuses the exchange unless it is repeated. */
	redirectUri: string;
	/** The OAuth client id. */
	clientId: string;
	/** The OAuth client secret. */
	clientSecret: string;
}

/**
 * Exchange the callback's code at Google's token endpoint and answer the ID token.
 *
 * Only the ID token is read: it carries who the person is, signed by Google, so no profile request follows. The
 * access token is left unused and expires on its own.
 *
 * @param context - The fetch and the deadline.
 * @param params - The code, the verifier and the credentials.
 * @returns The ID token, still to be verified.
 * @throws AuthProviderFailedError when Google refuses the code or answers without an ID token.
 * @example
 * ```ts
 * const idToken = await exchangeCode(context, { code, codeVerifier, redirectUri, clientId, clientSecret });
 * ```
 */
export const exchangeCode = async (context: RequestContext, params: ExchangeCodeParams): Promise<string> => {
	// 1. A form post, as OAuth prescribes; the secret travels in the body, which Google accepts as well as Basic auth
	const response = await request(context, TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code: params.code,
			client_id: params.clientId,
			client_secret: params.clientSecret,
			redirect_uri: params.redirectUri,
			code_verifier: params.codeVerifier,
		}).toString(),
	});

	// 2. A refusal names its OAuth error — `invalid_grant` for a spent or forged code — which leads the reason
	if (!response.ok) {
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: describeRefusal('the token endpoint', response) },
			{ cause: response.body },
		);
	}

	// 3. Without `openid` Google answers an access token only; that is a failure here, as the identity is read from
	//    the ID token
	const idToken = (response.body as { id_token?: unknown } | undefined)?.id_token;

	if (typeof idToken !== 'string' || !idToken) {
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: 'the token response carried no id_token' },
			{ cause: response.body },
		);
	}

	return idToken;
};
