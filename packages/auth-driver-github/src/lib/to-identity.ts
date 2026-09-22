import type { AuthIdentity } from '@novastarter/auth';
import { PROVIDER } from './constants.js';
import type { GithubProfile } from './fetch-profile.js';

/**
 * Turn the profile of the REST API into the identity `finishOAuth()` hands the application.
 *
 * The numeric id is the subject, as a string: the login can be renamed and then taken by someone else. The name falls
 * back to the login, since many accounts set none. An address is present only when it is the primary verified one,
 * so `emailVerified` is `true` whenever there is an address.
 *
 * @param profile - The profile and the address {@link fetchProfile} answered.
 * @returns The identity, with the profile as `raw`.
 * @example
 * ```ts
 * const identity = toIdentity(await fetchProfile(context, accessToken));
 * ```
 */
export const toIdentity = (profile: GithubProfile): AuthIdentity => {
	// 1. Empty strings are as good as absent: a name of `""` falls back to the login, an empty avatar is left out
	const { user, email } = profile;
	const name = typeof user.name === 'string' && user.name ? user.name : user.login;
	const avatarUrl = typeof user.avatar_url === 'string' && user.avatar_url ? user.avatar_url : undefined;

	// 2. Only fields with a value are set, so the identity carries no `undefined` keys
	return {
		provider: PROVIDER,
		subject: String(user.id),
		...(email ? { email, emailVerified: true } : {}),
		...(typeof name === 'string' && name ? { name } : {}),
		...(avatarUrl ? { avatarUrl } : {}),
		raw: user,
	};
};
