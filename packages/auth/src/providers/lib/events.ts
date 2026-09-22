import { useEmitter } from '@novastarter/emitter';
import { InvalidCredentialsError } from '@novastarter/errors';
import type { AuthIdentity } from '../types.js';

/**
 * Filter event an identity passes through before a sign-in succeeds; a handler may change it or return `null` to
 * refuse the sign-in — a banned account, a domain not allowed.
 *
 * @defaultValue `auth.sign-in`
 */
export const AUTH_SIGN_IN_FILTER = 'auth.sign-in';

/**
 * Action event after a sign-in succeeded.
 *
 * @defaultValue `auth.signed-in`
 */
export const AUTH_SIGNED_IN_EVENT = 'auth.signed-in';

/**
 * Action event after a sign-in failed: wrong credentials, a provider refusal, a filter veto.
 *
 * @defaultValue `auth.sign-in-failed`
 */
export const AUTH_SIGN_IN_FAILED_EVENT = 'auth.sign-in-failed';

/**
 * Run the identity through the sign-in filter and announce the sign-in.
 *
 * @param location - The location signed in through.
 * @param identity - What the driver proved.
 * @returns The identity, as the filter left it.
 * @throws InvalidCredentialsError when a filter handler refused the sign-in.
 * @internal
 */
export const completeSignIn = async (location: string, identity: AuthIdentity): Promise<AuthIdentity> => {
	// 1. The application's last word: a handler returning `null` refuses, which reads as wrong credentials to the
	//    client so it learns nothing about why
	const filtered = await useEmitter().emitFilter<AuthIdentity | null>(AUTH_SIGN_IN_FILTER, identity, { location });

	if (!filtered) {
		useEmitter().emitAction(AUTH_SIGN_IN_FAILED_EVENT, { location, provider: identity.provider, reason: 'filter' });

		throw new InvalidCredentialsError();
	}

	// 2. Announced once accepted; the identity goes under `payload`, since the emitter puts the event name under
	//    `event` in the meta
	useEmitter().emitAction(AUTH_SIGNED_IN_EVENT, { location, payload: filtered });

	return filtered;
};

/**
 * Announce a failed sign-in and hand the error back for rethrowing.
 *
 * @param location - The location signed in through.
 * @param error - What the driver threw.
 * @returns The same error.
 * @internal
 */
export const failSignIn = (location: string, error: unknown): unknown => {
	// 1. The reason is the error's code when it has one, so a listener can count refusals without parsing messages
	const reason = (error as { code?: unknown } | null)?.code ?? 'error';

	useEmitter().emitAction(AUTH_SIGN_IN_FAILED_EVENT, { location, reason });

	return error;
};
