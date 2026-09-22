import { AuthProviderFailedError } from '@novastarter/auth';
import { PROVIDER, TOKEN_URL } from './constants.js';
import { describeRefusal } from './describe-refusal.js';
import { request, type RequestContext } from './request.js';

/**
 * What the token exchange needs: the callback's code, the PKCE verifier and the app's credentials.
 */
export interface ExchangeCodeParams {
	/** The authorization code from the callback. */
	code: string;
	/** The PKCE verifier kept since the authorization began. */
	codeVerifier: string;
	/** The redirect URI sent with the authorization. */
	redirectUri: string;
	/** The client id of the OAuth app. */
	clientId: string;
	/** The client secret of the OAuth app. */
	clientSecret: string;
}

/**
 * Exchange the callback's code at GitHub's token endpoint and answer the access token.
 *
 * GitHub answers a refused code with `200 OK` and an `error` in the body — `bad_verification_code` for a spent or
 * forged one — so the body is checked as well as the status. `Accept: application/json` is required, or the answer is
 * form-encoded.
 *
 * @param context - The fetch and the deadline.
 * @param params - The code, the verifier and the credentials.
 * @returns The access token, for the profile requests that follow.
 * @throws AuthProviderFailedError when GitHub refuses the code or answers without a token.
 * @example
 * ```ts
 * const accessToken = await exchangeCode(context, { code, codeVerifier, redirectUri, clientId, clientSecret });
 * ```
 */
export const exchangeCode = async (context: RequestContext, params: ExchangeCodeParams): Promise<string> => {
	// 1. A form post, as OAuth prescribes, asking for JSON back
	const response = await request(context, TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body: new URLSearchParams({
			client_id: params.clientId,
			client_secret: params.clientSecret,
			code: params.code,
			redirect_uri: params.redirectUri,
			code_verifier: params.codeVerifier,
		}).toString(),
	});

	// 2. A refusal hides in a 200 as often as it comes with an error status; either way its OAuth error is the reason
	const body = response.body as { access_token?: unknown; error?: unknown } | undefined;

	if (!response.ok || body?.error !== undefined) {
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: describeRefusal('the token endpoint', response) },
			{ cause: response.body },
		);
	}

	// 3. An answer without a token cannot sign anyone in, whatever its status
	if (typeof body?.access_token !== 'string' || !body.access_token) {
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: 'the token response carried no access_token' },
			{ cause: response.body },
		);
	}

	return body.access_token;
};
