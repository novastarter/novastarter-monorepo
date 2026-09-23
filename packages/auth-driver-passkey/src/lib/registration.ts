import { AuthInvalidTokenError, openChallenge, sealChallenge, useAuth } from '@novastarter/auth';
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { AuthDriverPasskey, type PasskeyCredential, type PasskeyRegistrationParams } from './driver.js';

/**
 * The purpose the registration cookie is sealed under, so it cannot be played into a sign-in or the other way round.
 *
 * @defaultValue `passkey-registration`
 */
export const PASSKEY_REGISTRATION_PURPOSE = 'passkey-registration';

/**
 * What {@link startPasskeyRegistration} answers with.
 */
export interface StartedPasskeyRegistration {
	/** The options for `navigator.credentials.create()`. */
	options: PublicKeyCredentialCreationOptionsJSON;
	/** The cookie to set, carrying the challenge and the account. */
	cookie: string;
	/** When the cookie stops being accepted, in milliseconds since the epoch. */
	expiresAt: number;
}

/**
 * What {@link finishPasskeyRegistration} takes.
 */
export interface FinishPasskeyRegistrationParams {
	/** The account signed in now; must be the one the registration started for. */
	userId: string;
	/** What `navigator.credentials.create()` resolved with, as JSON. */
	response: RegistrationResponseJSON;
	/** The cookie {@link startPasskeyRegistration} handed out. */
	cookie: string | undefined;
}

/**
 * The passkey driver of a location.
 *
 * @param location - The location.
 * @returns Its driver.
 * @throws Error when the location's driver is not the passkey one.
 * @internal
 */
const passkeyDriver = (location: string): AuthDriverPasskey => {
	// 1. Registration is this driver's own flow; another driver behind the name is a configuration mistake
	const driver = useAuth().location(location);

	if (!(driver instanceof AuthDriverPasskey)) {
		throw new Error(`Auth location "${location}" is not a passkey one`);
	}

	return driver;
};

/**
 * Begin adding a passkey to the account signed in now: make the creation options and seal their challenge, with the
 * account, into a cookie with the `challenge.secret` of `@novastarter/auth`.
 *
 * This is not a sign-in — the caller has already checked the session — so no limiter is charged and no event is
 * emitted.
 *
 * @param location - The passkey location.
 * @param params - The account, its name for the prompt, and its keys already stored.
 * @returns The options for the browser, and the cookie to set with its expiry.
 * @throws Error when the location's driver is not the passkey one, or without a usable `challenge.secret`.
 * @example
 * ```ts
 * const { options, cookie, expiresAt } = await startPasskeyRegistration('passkey', {
 * 	userId: session.userId,
 * 	userName: user.email,
 * 	exclude: await listPasskeys(session.userId),
 * });
 * ```
 */
export const startPasskeyRegistration = async (
	location: string,
	params: PasskeyRegistrationParams,
): Promise<StartedPasskeyRegistration> => {
	// 1. The options first, so their challenge is the one sealed
	const options = await passkeyDriver(location).registrationOptions(params);

	// 2. The account goes into the cookie too, so the key cannot be finished for another one
	const { cookie, expiresAt } = sealChallenge(location, PASSKEY_REGISTRATION_PURPOSE, {
		challenge: options.challenge,
		userId: params.userId,
	});

	return { options, cookie, expiresAt };
};

/**
 * Finish adding a passkey: open the cookie, check it was made for the account signed in now, and verify the new key.
 *
 * The application stores the record it gets back and deletes the cookie whatever the outcome.
 *
 * @param location - The passkey location.
 * @param params - The account signed in now, the browser's answer, and the cookie.
 * @returns The key, for the application to store.
 * @throws AuthInvalidTokenError when the cookie is missing, tampered with, expired, or made for another account.
 * @throws InvalidCredentialsError when the answer does not check out.
 * @throws Error when the location's driver is not the passkey one, or without a usable `challenge.secret`.
 * @example
 * ```ts
 * const key = await finishPasskeyRegistration('passkey', { userId: session.userId, response, cookie });
 *
 * await db.insert(passkeys).values(key);
 * ```
 */
export const finishPasskeyRegistration = async (
	location: string,
	params: FinishPasskeyRegistrationParams,
): Promise<PasskeyCredential> => {
	// 1. The driver first, so a configuration mistake is reported as itself
	const driver = passkeyDriver(location);

	// 2. The cookie must open for this location and flow, and name the account signed in now
	const state = openChallenge(location, PASSKEY_REGISTRATION_PURPOSE, params.cookie);

	if (!state || typeof state['challenge'] !== 'string' || state['userId'] !== params.userId) {
		throw new AuthInvalidTokenError();
	}

	// 3. The key itself
	return driver.verifyRegistration(params.response, state['challenge'], params.userId);
};
