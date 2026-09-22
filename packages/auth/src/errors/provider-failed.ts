import { createError, type NovastarterErrorConstructor } from '@novastarter/errors';

/**
 * Context of {@link AuthProviderFailedError}.
 */
export interface AuthProviderFailedErrorExtensions {
	/** The provider that failed: `google`, `github`. */
	provider: string;
	/** What went wrong, as far as the provider said. */
	reason: string;
}

/**
 * Thrown by a sign-in driver when its provider refused the exchange or answered with something unusable: a code
 * exchange the provider rejected, an ID token that fails verification, a profile without the fields sign-in needs.
 *
 * Status 502, since it is the upstream that failed rather than the request; the provider's own error travels as the
 * `cause`.
 *
 * @example
 * ```ts
 * throw new AuthProviderFailedError({ provider: 'github', reason: 'bad_verification_code' });
 * ```
 */
export const AuthProviderFailedError: NovastarterErrorConstructor<AuthProviderFailedErrorExtensions> =
	createError<AuthProviderFailedErrorExtensions>(
		'AUTH_PROVIDER_FAILED',
		({ provider, reason }) => `The ${provider} sign-in failed: ${reason}`,
		502,
	);
