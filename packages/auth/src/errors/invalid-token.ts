import { createError, type NovastarterErrorConstructor } from '@novastarter/errors';

/**
 * Thrown when a token cannot be used: a one-time token that does not exist, expired or was spent already, a JWT that
 * fails its signature or claims, a refresh token that was replayed, an OAuth state nobody issued.
 *
 * The cases are deliberately not told apart: a caller probing tokens learns nothing from the error about which of
 * them it hit. Status 401, since the request carries no usable proof of who sent it.
 *
 * @example
 * ```ts
 * try {
 * 	await checkToken({ purpose: 'password-reset', token, spend });
 * } catch (error) {
 * 	if (error instanceof AuthInvalidTokenError) return redirect('/reset/expired');
 * 	throw error;
 * }
 * ```
 */
export const AuthInvalidTokenError: NovastarterErrorConstructor = createError(
	'AUTH_INVALID_TOKEN',
	'The token is invalid or has expired',
	401,
);
