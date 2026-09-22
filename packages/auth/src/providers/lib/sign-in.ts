import { authSettings } from '../../lib/settings-access.js';
import { useAuth } from '../../lib/use-auth.js';
import type { AuthIdentity, Credentials } from '../types.js';
import { completeSignIn, failSignIn } from './events.js';

/**
 * Sign in with what a person typed, through a location whose driver checks credentials (`credentials`).
 *
 * Every attempt costs a point of the `signIn` limiter, keyed by location and identifier, so passwords cannot be tried
 * one after another against an account; a success clears the count. The identity then passes the `auth.sign-in`
 * filter and `auth.signed-in` is emitted; a failure emits `auth.sign-in-failed`. What to do with the identity — a
 * session, a token pair, a TOTP prompt — is the caller's.
 *
 * @param location - The location to sign in through.
 * @param credentials - Identifier and password.
 * @returns The identity.
 * @throws InvalidCredentialsError when the credentials do not match or a filter refused.
 * @throws HitRateLimitError when the identifier tried too often.
 * @throws Error when the location does not exist or its driver cannot check credentials.
 * @example
 * ```ts
 * const identity = await signIn('credentials', { identifier: form.email, password: form.password });
 * const { token, session } = createSession(identity.subject);
 * ```
 */
export const signIn = async (location: string, credentials: Credentials): Promise<AuthIdentity> => {
	// 1. The driver first, so a configuration mistake is reported before anything is charged
	const driver = useAuth().location(location);

	if (!driver.authenticate) {
		throw new Error(`Auth location "${location}" does not sign in with credentials`);
	}

	// 2. Charged per account rather than per client, so spreading the guesses over many IP addresses does not help;
	//    the identifier is folded to one case since addresses compare that way
	const limiter = authSettings().limiters?.signIn;
	const key = `${location}:${String(credentials.identifier).trim().toLowerCase()}`;

	await limiter?.consume(key);

	// 3. The driver's verdict; a refusal is announced and rethrown as the driver made it
	let identity: AuthIdentity;

	try {
		identity = await driver.authenticate(credentials);
	} catch (error) {
		throw failSignIn(location, error);
	}

	// 4. A success clears the count before the filter runs, so a typo or two earlier does not linger
	await limiter?.delete(key);

	return completeSignIn(location, identity);
};
