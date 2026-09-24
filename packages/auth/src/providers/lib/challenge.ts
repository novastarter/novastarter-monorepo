import { InvalidConfigError } from '@novastarter/errors';
import { AuthInvalidTokenError } from '../../errors/index.js';
import { requireSecrets } from '../../lib/require-secret.js';
import { authSettings } from '../../lib/settings-access.js';
import { DEFAULT_CHALLENGE_TTL } from '../../lib/settings.js';
import { useAuth } from '../../lib/use-auth.js';
import { decrypt, encrypt } from '../../utils/index.js';
import type { AuthIdentity, ChallengeInput } from '../types.js';
import { completeSignIn, failSignIn } from './events.js';

/**
 * What the purpose of the challenge cookie `startChallenge()` seals is: the state of a sign-in.
 *
 * A driver sealing state of its own — a passkey's registration — uses another purpose, so a cookie of one flow cannot
 * be played into the other.
 *
 * @defaultValue `sign-in`
 */
export const CHALLENGE_SIGN_IN_PURPOSE = 'sign-in';

/**
 * What {@link startChallenge} answers with.
 */
export interface StartedChallenge {
	/** What the browser needs for the second step; `undefined` when the driver has nothing to hand it. */
	options: unknown;
	/** The cookie to set, carrying the driver's state; `undefined` when the driver keeps no state. */
	cookie: string | undefined;
	/** When the cookie stops being accepted, in milliseconds since the epoch; `undefined` without a cookie. */
	expiresAt: number | undefined;
}

/**
 * What {@link finishChallenge} takes.
 */
export interface FinishChallengeParams {
	/** What the browser sent back: the token of a link, a code, a passkey's signed answer. */
	input: ChallengeInput;
	/** The cookie {@link startChallenge} handed out, when the browser has it. */
	cookie?: string | undefined;
}

/**
 * A sealed challenge cookie, as {@link sealChallenge} hands it out.
 */
export interface SealedChallenge {
	/** The cookie's value. */
	cookie: string;
	/** When it stops being accepted, in milliseconds since the epoch. */
	expiresAt: number;
}

/**
 * What the challenge cookie carries.
 *
 * @internal
 */
interface ChallengeCookie {
	location: string;
	purpose: string;
	expiresAt: number;
	state: Record<string, unknown>;
}

/**
 * Seal a driver's state into a cookie for the second step of a flow: encrypted and authenticated with
 * `challenge.secret`, bound to the location and the purpose, and valid for `challenge.ttl`.
 *
 * `startChallenge()` seals the state of a sign-in with it; a driver package seals the state of a flow of its own — a
 * passkey's registration — under another purpose.
 *
 * @param location - The location the flow runs through.
 * @param purpose - What the flow is: {@link CHALLENGE_SIGN_IN_PURPOSE}, or a driver's own name for it.
 * @param state - What to get back at the second step.
 * @returns The cookie and its expiry.
 * @throws InvalidConfigError without a usable `challenge.secret` in the settings.
 * @example
 * ```ts
 * const { cookie, expiresAt } = sealChallenge('passkey', 'passkey-registration', { challenge, userId });
 * ```
 */
export const sealChallenge = (location: string, purpose: string, state: Record<string, unknown>): SealedChallenge => {
	// The current secret encrypts; a secret being rotated out only still opens what it sealed
	const settings = authSettings().challenge ?? {};
	const secret = requireSecrets(settings.secret, 'challenge.secret')[0]!;
	const expiresAt = Date.now() + (settings.ttl ?? DEFAULT_CHALLENGE_TTL);

	// Sealed with the location, the purpose and the deadline, so a cookie cannot be replayed elsewhere or later
	const sealed: ChallengeCookie = { location, purpose, expiresAt, state };

	return { cookie: encrypt(JSON.stringify(sealed), secret, 'challenge-cookie'), expiresAt };
};

/**
 * Open a cookie {@link sealChallenge} made.
 *
 * @param location - The location the second step runs through; must be the one the cookie was sealed for.
 * @param purpose - The flow; must be the one the cookie was sealed for.
 * @param cookie - The cookie's value.
 * @returns The state; `null` when the cookie is missing, tampered with, expired, or sealed for another location or
 * purpose — all the same to the caller, which refuses the step.
 * @throws InvalidConfigError without a usable `challenge.secret` in the settings.
 */
export const openChallenge = (
	location: string,
	purpose: string,
	cookie: string | undefined,
): Record<string, unknown> | null => {
	// The secrets first, so a configuration mistake is reported as itself rather than as a bad cookie
	const secrets = requireSecrets(authSettings().challenge?.secret, 'challenge.secret');

	if (typeof cookie !== 'string' || cookie.length === 0) {
		return null;
	}

	// GCM refuses a changed byte or another key; either is just an unusable cookie here
	let sealed: ChallengeCookie;

	try {
		sealed = JSON.parse(decrypt(cookie, secrets, 'challenge-cookie').plaintext) as ChallengeCookie;
	} catch {
		return null;
	}

	if (sealed.expiresAt <= Date.now() || sealed.location !== location || sealed.purpose !== purpose) {
		return null;
	}

	return sealed.state;
};

/**
 * Begin a two-step sign-in through a location whose driver has one: send a link or a code by mail, make a passkey's
 * challenge.
 *
 * An input with an `identifier` costs a point of the `signIn` limiter, keyed by location and identifier, so one
 * address cannot be flooded with links. Whatever state the driver keeps for the second step is sealed into a cookie
 * with `challenge.secret`; nothing is stored on the server.
 *
 * @param location - The location to sign in through: `magic-link`, `passkey`.
 * @param input - What the browser sent: an email address, the format wanted.
 * @returns The options for the browser, and the cookie to set with its expiry when the driver keeps state.
 * @throws HitRateLimitError when the identifier asked too often.
 * @throws InvalidConfigError when the location does not exist or its driver has no two-step sign-in, or without a
 * usable `challenge.secret` in the settings while the driver keeps state.
 * @example
 * ```ts
 * const { options, cookie, expiresAt } = await startChallenge('passkey');
 *
 * if (cookie) {
 * 	jar.set('challenge', cookie, { httpOnly: true, secure: true, sameSite: 'lax', expires: expiresAt });
 * }
 * return Response.json(options);
 * ```
 */
export const startChallenge = async (location: string, input: ChallengeInput = {}): Promise<StartedChallenge> => {
	// The driver first, so a configuration mistake is reported before anything is charged
	const driver = useAuth().location(location);

	if (!driver.begin || !driver.complete) {
		throw new InvalidConfigError({
			reason: `Auth location "${location}" does not sign in with a challenge, register it with a driver that does`,
		});
	}

	// Charged per address rather than per client, like `signIn()`; never cleared here, since asking again is not a
	// success that should reset the count
	if (typeof input.identifier === 'string') {
		await authSettings().limiters?.signIn?.consume(`${location}:${input.identifier.trim().toLowerCase()}`);
	}

	const begun = await driver.begin(input);

	if (!begun.state) {
		return { options: begun.options, cookie: undefined, expiresAt: undefined };
	}

	const { cookie, expiresAt } = sealChallenge(location, CHALLENGE_SIGN_IN_PURPOSE, begun.state);

	return { options: begun.options, cookie, expiresAt };
};

/**
 * Finish a two-step sign-in with what the browser sent back.
 *
 * The cookie is optional: a link sent by mail may be opened in another browser than the one that asked for it, and
 * its driver keeps nothing in the cookie. A cookie that is given has to open, though — a tampered or expired one is
 * refused rather than ignored. The application deletes the cookie whatever the outcome. The identity passes the
 * `auth.sign-in` filter and `auth.signed-in` is emitted; a failure emits `auth.sign-in-failed`.
 *
 * @param location - The location the flow started through.
 * @param params - What the browser sent back, and the cookie.
 * @returns The identity.
 * @throws AuthInvalidTokenError when the cookie is tampered with, expired or made for another location, or the driver
 * refuses a token.
 * @throws InvalidCredentialsError when the driver refuses the answer or a filter refused the sign-in.
 * @throws InvalidConfigError when the location does not exist or its driver has no two-step sign-in, or without a
 * usable `challenge.secret` in the settings while a cookie is given.
 * @example
 * ```ts
 * const identity = await finishChallenge('magic-link', { input: { token: query.token } });
 * const { token, session } = createSession(identity.subject);
 * ```
 */
export const finishChallenge = async (location: string, params: FinishChallengeParams): Promise<AuthIdentity> => {
	// The driver first, so a configuration mistake is reported as itself
	const driver = useAuth().location(location);

	if (!driver.begin || !driver.complete) {
		throw new InvalidConfigError({
			reason: `Auth location "${location}" does not sign in with a challenge, register it with a driver that does`,
		});
	}

	// A cookie that is there must open; its absence is the driver's to judge
	let state: Record<string, unknown> | undefined;

	if (params.cookie !== undefined) {
		const opened = openChallenge(location, CHALLENGE_SIGN_IN_PURPOSE, params.cookie);

		if (!opened) {
			throw failSignIn(location, new AuthInvalidTokenError());
		}

		state = opened;
	}

	// The driver's verdict; a refusal is announced and rethrown as the driver made it
	let identity: AuthIdentity;

	try {
		identity = await driver.complete(params.input, state);
	} catch (error) {
		throw failSignIn(location, error);
	}

	return completeSignIn(location, identity);
};
