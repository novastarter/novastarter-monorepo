import { createHash } from 'node:crypto';
import { AuthInvalidTokenError } from '../../errors/index.js';
import { requireSecrets } from '../../lib/require-secret.js';
import { authSettings } from '../../lib/settings-access.js';
import { DEFAULT_OAUTH_STATE_TTL } from '../../lib/settings.js';
import { useAuth } from '../../lib/use-auth.js';
import { decrypt, encrypt, randomToken, safeEqual } from '../../utils/index.js';
import type { AuthIdentity } from '../types.js';
import { completeSignIn, failSignIn } from './events.js';

/**
 * Per-call options of {@link startOAuth}.
 */
export interface StartOAuthOptions {
	/** The callback URL, as registered with the provider. */
	redirectUri: string;
	/** Scopes to ask for instead of the driver's defaults. */
	scopes?: string[] | undefined;
	/** What to get back in {@link finishOAuth}: the page to return to. Travels encrypted in the cookie, so keep it small. */
	data?: Record<string, unknown> | undefined;
}

/**
 * What {@link startOAuth} hands back.
 */
export interface StartedOAuth {
	/** Where to redirect the browser. */
	url: URL;
	/**
	 * The value of the OAuth cookie: the state, the PKCE verifier and the nonce, encrypted. The application sets it
	 * `HttpOnly`, `Secure`, `SameSite=Lax`, until {@link expiresAt}, and hands it to {@link finishOAuth}.
	 */
	cookie: string;
	/** When the cookie stops being accepted, epoch milliseconds. */
	expiresAt: number;
}

/**
 * What {@link finishOAuth} needs from the callback request.
 */
export interface FinishOAuthParams {
	/** The `state` parameter of the callback. */
	state: string;
	/** The `code` parameter of the callback. */
	code: string;
	/** The value of the OAuth cookie {@link startOAuth} made. */
	cookie: string | undefined;
}

/**
 * What {@link finishOAuth} hands back.
 */
export interface FinishedOAuth {
	/** Who the provider says the person is. */
	identity: AuthIdentity;
	/** What {@link startOAuth} was given to keep. */
	data?: Record<string, unknown> | undefined;
}

/**
 * What the OAuth cookie carries.
 *
 * @internal
 */
interface OAuthCookie {
	location: string;
	state: string;
	codeVerifier: string;
	nonce: string;
	redirectUri: string;
	expiresAt: number;
	data?: Record<string, unknown>;
}

/**
 * Begin an OAuth sign-in: make the state, the PKCE verifier and the nonce, seal them into a cookie, and build the
 * provider's URL.
 *
 * Nothing is stored on the server: the cookie is encrypted and authenticated with `oauth.secret` (AES-256-GCM), so the
 * browser carries the secrets without being able to read or change them. The state ties the callback to this browser,
 * the verifier (PKCE, S256) makes an intercepted code useless to anyone else, the nonce ties the ID token to this start.
 *
 * @param location - The location of the provider: `google`, `github`.
 * @param options - The callback URL, scopes and data to keep.
 * @returns The URL to redirect to, and the cookie to set with its expiry.
 * @throws Error when the location does not exist or its driver is not an OAuth one, or without a usable
 * `oauth.secret` in the settings.
 * @example
 * ```ts
 * const { url, cookie, expiresAt } = await startOAuth('github', { redirectUri: `${origin}/auth/github/callback` });
 *
 * cookies().set('oauth', cookie, { httpOnly: true, secure: true, sameSite: 'lax', expires: expiresAt });
 * return Response.redirect(url);
 * ```
 */
export const startOAuth = async (location: string, options: StartOAuthOptions): Promise<StartedOAuth> => {
	// 1. The driver and the secret first, so a configuration mistake is reported before anything is made
	const driver = useAuth().location(location);

	if (!driver.authorize) {
		throw new Error(`Auth location "${location}" does not sign in with OAuth`);
	}

	const settings = authSettings().oauth ?? {};
	const secret = requireSecrets(settings.secret, 'oauth.secret')[0]!;

	// 2. Three secrets and the S256 challenge of the verifier — the only PKCE method worth sending
	const state = randomToken();
	const codeVerifier = randomToken();
	const nonce = randomToken(16);
	const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
	const expiresAt = Date.now() + (settings.stateTtl ?? DEFAULT_OAUTH_STATE_TTL);

	// 3. Sealed together with the location and the deadline, so a cookie cannot be replayed elsewhere or later
	const sealed: OAuthCookie = {
		location,
		state,
		codeVerifier,
		nonce,
		redirectUri: options.redirectUri,
		expiresAt,
		...(options.data ? { data: options.data } : {}),
	};

	const url = await driver.authorize({
		state,
		codeChallenge,
		nonce,
		redirectUri: options.redirectUri,
		...(options.scopes ? { scopes: options.scopes } : {}),
	});

	return { url, cookie: encrypt(JSON.stringify(sealed), secret, 'oauth-cookie'), expiresAt };
};

/**
 * Finish an OAuth sign-in from the callback: open the cookie, match the state, and let the driver exchange the code.
 *
 * The application deletes the cookie whatever the outcome — a callback is good for one attempt, and the provider
 * accepts a code only once anyway. The identity passes the `auth.sign-in` filter and `auth.signed-in` is emitted; a
 * failure emits `auth.sign-in-failed`. What to do with the identity — find or link the account, start a session — is
 * the caller's.
 *
 * @param location - The location the callback belongs to; must be the one the cookie was made for.
 * @param params - `state` and `code` from the callback, and the cookie.
 * @returns The identity and the data kept since the start.
 * @throws AuthInvalidTokenError when the cookie is missing, tampered with, expired, made for another location, or its
 * state is not the callback's.
 * @throws AuthProviderFailedError when the provider refused the code or its answer did not check out.
 * @throws InvalidCredentialsError when a filter refused the sign-in.
 * @throws Error when the location does not exist or its driver is not an OAuth one, or without a usable
 * `oauth.secret` in the settings.
 * @example
 * ```ts
 * const jar = await cookies();
 * const { identity } = await finishOAuth('github', { state: query.state, code: query.code, cookie: jar.get('oauth')?.value });
 *
 * jar.delete('oauth');
 * ```
 */
export const finishOAuth = async (location: string, params: FinishOAuthParams): Promise<FinishedOAuth> => {
	// 1. The driver and the secret first, so a configuration mistake is reported as itself
	const driver = useAuth().location(location);

	if (!driver.callback) {
		throw new Error(`Auth location "${location}" does not sign in with OAuth`);
	}

	const secrets = requireSecrets(authSettings().oauth?.secret, 'oauth.secret');

	// 2. The cookie must open with one of the secrets, be current, belong to this location and carry the callback's state;
	//    every failure is the same error, and the state is compared in constant time
	const sealed = open(params.cookie, secrets);

	if (
		!sealed ||
		sealed.expiresAt <= Date.now() ||
		sealed.location !== location ||
		typeof params.state !== 'string' ||
		!safeEqual(sealed.state, params.state)
	) {
		throw failSignIn(location, new AuthInvalidTokenError());
	}

	// 3. The driver exchanges the code with the verifier and checks what comes back
	let identity: AuthIdentity;

	try {
		identity = await driver.callback({
			code: params.code,
			codeVerifier: sealed.codeVerifier,
			nonce: sealed.nonce,
			redirectUri: sealed.redirectUri,
		});
	} catch (error) {
		throw failSignIn(location, error);
	}

	return { identity: await completeSignIn(location, identity), ...(sealed.data ? { data: sealed.data } : {}) };
};

/**
 * Open an OAuth cookie.
 *
 * @param cookie - The cookie's value.
 * @param secrets - The `oauth.secret` list, current first; a secret being rotated out still opens a cookie it sealed.
 * @returns What it carries; `null` when it is missing, tampered with or sealed with none of the secrets.
 * @internal
 */
const open = (cookie: string | undefined, secrets: readonly string[]): OAuthCookie | null => {
	// 1. GCM refuses a changed byte or another key; either is just an unusable cookie here
	if (typeof cookie !== 'string' || cookie.length === 0) {
		return null;
	}

	try {
		return JSON.parse(decrypt(cookie, secrets, 'oauth-cookie').plaintext) as OAuthCookie;
	} catch {
		return null;
	}
};
