/**
 * The provider name the driver reports in identities and errors.
 *
 * @defaultValue `github`
 */
export const PROVIDER = 'github';

/**
 * GitHub's consent page, where {@link AuthDriverGithub.authorize} sends the browser.
 *
 * @defaultValue `https://github.com/login/oauth/authorize`
 */
export const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

/**
 * GitHub's token endpoint, where the callback's code is exchanged for an access token.
 *
 * @defaultValue `https://github.com/login/oauth/access_token`
 */
export const TOKEN_URL = 'https://github.com/login/oauth/access_token';

/**
 * The REST endpoint of the signed-in user's profile.
 *
 * @defaultValue `https://api.github.com/user`
 */
export const USER_URL = 'https://api.github.com/user';

/**
 * The REST endpoint of the signed-in user's addresses, with whether each is primary and verified.
 *
 * @defaultValue `https://api.github.com/user/emails`
 */
export const EMAILS_URL = 'https://api.github.com/user/emails';

/**
 * The REST API version every request pins, so a later default cannot change the answers under the driver.
 *
 * @defaultValue `2022-11-28`
 */
export const API_VERSION = '2022-11-28';

/**
 * The `User-Agent` of the REST requests: GitHub refuses a request without one.
 *
 * @defaultValue `@novastarter/auth-driver-github`
 */
export const USER_AGENT = '@novastarter/auth-driver-github';

/**
 * The scopes asked for when neither the location nor the call names any: the profile and the addresses, including
 * private ones, since the public profile address may be empty and carries no verification.
 *
 * @defaultValue `read:user user:email`
 */
export const DEFAULT_SCOPES: readonly string[] = ['read:user', 'user:email'];

/**
 * How long one request to GitHub may take, in milliseconds, when the location sets no `timeout`.
 *
 * @defaultValue 10 seconds.
 */
export const DEFAULT_TIMEOUT = 10_000;
