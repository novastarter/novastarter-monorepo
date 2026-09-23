import { AuthProviderFailedError, type OAuthTokens } from '@novastarter/auth';
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
 * What {@link exchangeCode} answers: the ID token to verify and the tokens to hand on.
 */
export interface ExchangedCode {
	/** The ID token, still to be verified. */
	idToken: string;
	/** The access token Google issued with it, and the refresh token, expiry and scopes when Google names them. */
	tokens?: OAuthTokens | undefined;
}

/**
 * Exchange the callback's code at Google's token endpoint and answer the ID token and the tokens issued with it.
 *
 * The person is read from the ID token alone: it carries who they are, signed by Google, so no profile request follows.
 * The access token — with a refresh token when the consent asked for offline access — is handed on for the application
 * to call Google's APIs with; the driver does not use it.
 *
 * @param context - The fetch and the deadline.
 * @param params - The code, the verifier and the credentials.
 * @returns The ID token, still to be verified, and the tokens.
 * @throws AuthProviderFailedError when Google refuses the code or answers without an ID token.
 * @example
 * ```ts
 * const { idToken, tokens } = await exchangeCode(context, { code, codeVerifier, redirectUri, clientId, clientSecret });
 * ```
 */
export const exchangeCode = async (context: RequestContext, params: ExchangeCodeParams): Promise<ExchangedCode> => {
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
	const body = response.body as
		| {
				id_token?: unknown;
				access_token?: unknown;
				refresh_token?: unknown;
				expires_in?: unknown;
				scope?: unknown;
				token_type?: unknown;
		  }
		| undefined;

	const idToken = body?.id_token;

	if (typeof idToken !== 'string' || !idToken) {
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: 'the token response carried no id_token' },
			{ cause: response.body },
		);
	}

	// 4. The access token and what Google says of it, in the shape of every driver: the expiry from seconds left into
	//    a moment, the space-separated scopes into a list; the refresh token only comes with offline access
	if (typeof body?.access_token !== 'string' || !body.access_token) {
		return { idToken };
	}

	const tokens: OAuthTokens = {
		accessToken: body.access_token,
		...(typeof body.refresh_token === 'string' && body.refresh_token ? { refreshToken: body.refresh_token } : {}),
		...(typeof body.expires_in === 'number' ? { expiresAt: Date.now() + body.expires_in * 1000 } : {}),
		...(typeof body.scope === 'string' ? { scope: body.scope.split(/\s+/).filter(Boolean) } : {}),
		...(typeof body.token_type === 'string' ? { tokenType: body.token_type } : {}),
	};

	return { idToken, tokens };
};
