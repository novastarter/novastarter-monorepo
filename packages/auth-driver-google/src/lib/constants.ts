/**
 * The provider name the driver reports in identities and errors.
 *
 * @defaultValue `google`
 */
export const PROVIDER = 'google';

/**
 * Google's consent page, where {@link AuthDriverGoogle.authorize} sends the browser.
 *
 * @defaultValue `https://accounts.google.com/o/oauth2/v2/auth`
 */
export const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * Google's token endpoint, where the callback's code is exchanged for an ID token.
 *
 * @defaultValue `https://oauth2.googleapis.com/token`
 */
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * The key set Google signs its ID tokens with.
 *
 * @defaultValue `https://www.googleapis.com/oauth2/v3/certs`
 */
export const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * The issuers an ID token from Google may name: Google documents both, with and without the scheme.
 *
 * @defaultValue `https://accounts.google.com` and `accounts.google.com`.
 */
export const ISSUERS: string[] = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * The scopes asked for when neither the location nor the call names any: the ID token plus the address and the
 * profile, which is what an {@link AuthIdentity} carries.
 *
 * @defaultValue `openid email profile`
 */
export const DEFAULT_SCOPES: readonly string[] = ['openid', 'email', 'profile'];

/**
 * How long one request to Google may take, in milliseconds, when the location sets no `timeout`.
 *
 * @defaultValue 10 seconds.
 */
export const DEFAULT_TIMEOUT = 10_000;

/**
 * The root of Google's APIs, which the path of a `call()` method is joined to.
 *
 * @defaultValue `https://www.googleapis.com`
 */
export const API_URL = 'https://www.googleapis.com';

/**
 * The hosts a full URL in a `call()` method may point at: any subdomain of `googleapis.com`, where Google's APIs live
 * (`gmail.googleapis.com`, `people.googleapis.com`, `oauth2.googleapis.com`). Any other host is refused before the
 * request, so a person's token never leaves Google.
 *
 * @defaultValue `*.googleapis.com`
 * @internal
 */
export const CALL_HOSTS: readonly string[] = ['*.googleapis.com'];
