import { AuthProviderFailedError } from '@novastarter/auth';
import { API_VERSION, EMAILS_URL, PROVIDER, USER_AGENT, USER_URL } from './constants.js';
import { describeRefusal } from './describe-refusal.js';
import { pickEmail } from './pick-email.js';
import { request, type RequestContext } from './request.js';

/**
 * The fields of GitHub's `GET /user` the driver reads; the rest travels untouched as the identity's `raw`.
 */
export interface GithubUser {
	/** The numeric account id: stable across renames, unlike the login. */
	id: number;
	/** The user name. */
	login: string;
	/** The display name, when the person set one. */
	name?: string | null | undefined;
	/** The avatar URL. */
	avatar_url?: string | null | undefined;
	/** Every other field of the profile. */
	[field: string]: unknown;
}

/**
 * What {@link fetchProfile} answers: the profile and the address to sign in with.
 */
export interface GithubProfile {
	/** The profile of `GET /user`. */
	user: GithubUser;
	/** The primary verified address, when there is one. */
	email?: string | undefined;
}

/**
 * Read the signed-in person's profile and addresses from the REST API.
 *
 * Both requests go out at once. The profile is required: without it there is no id. The addresses are not: without
 * the `user:email` scope GitHub answers them with 403 or 404, and the identity then carries no address rather than
 * failing the sign-in; any other refusal of them fails it, since an outage should not pass for "no address".
 *
 * @param context - The fetch and the deadline.
 * @param accessToken - The token of the code exchange.
 * @returns The profile and the primary verified address.
 * @throws AuthProviderFailedError when a request fails, is refused, or the profile has no numeric id.
 * @example
 * ```ts
 * const { user, email } = await fetchProfile(context, accessToken);
 * ```
 */
export const fetchProfile = async (context: RequestContext, accessToken: string): Promise<GithubProfile> => {
	// 1. The headers GitHub asks every REST client for: the token, its media type, a pinned version and a user agent,
	//    without which the request is refused
	const init = {
		method: 'GET' as const,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': API_VERSION,
			'User-Agent': USER_AGENT,
		},
	};

	const [user, emails] = await Promise.all([request(context, USER_URL, init), request(context, EMAILS_URL, init)]);

	// 2. No profile, no sign-in; a profile without a numeric id has nothing stable to link by
	if (!user.ok) {
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: describeRefusal('the user endpoint', user) },
			{ cause: user.body },
		);
	}

	const profile = user.body as Partial<GithubUser> | undefined;

	if (typeof profile?.id !== 'number') {
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: 'the user profile carried no id' },
			{ cause: user.body },
		);
	}

	// 3. A scope not granted reads as no address; anything else refused is a failure worth reporting
	if (!emails.ok && emails.status !== 403 && emails.status !== 404) {
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: describeRefusal('the emails endpoint', emails) },
			{ cause: emails.body },
		);
	}

	const email = emails.ok ? pickEmail(emails.body) : undefined;

	return { user: profile as GithubUser, ...(email ? { email } : {}) };
};
