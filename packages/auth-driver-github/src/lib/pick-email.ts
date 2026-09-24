/**
 * One entry of GitHub's `GET /user/emails`.
 */
export interface GithubEmail {
	/** The address. */
	email: string;
	/** Whether it is the account's primary address. */
	primary: boolean;
	/** Whether GitHub confirmed the person owns it. */
	verified: boolean;
	/** `public`, `private` or `null`. */
	visibility?: string | null | undefined;
}

/**
 * Pick the address to sign in with from the list of `GET /user/emails`: the primary one, when GitHub verified it.
 *
 * Only a verified address may be used to link accounts, and the primary one is the one the person chose; a primary
 * address that is not verified, or a verified one that is not primary, is not picked — the identity then carries no
 * address rather than one the application might trust wrongly. Entries of the wrong shape are skipped, since the list
 * comes from the network.
 *
 * @param emails - The parsed body of `GET /user/emails`; anything but an array counts as empty.
 * @returns The primary verified address, or `undefined`.
 * @example
 * ```ts
 * pickEmail([{ email: 'ada@example.com', primary: true, verified: true }]);
 * // => 'ada@example.com'
 * ```
 */
export const pickEmail = (emails: unknown): string | undefined => {
	// A scope not granted or a malformed answer gives a body that is not a list
	if (!Array.isArray(emails)) {
		return undefined;
	}

	// Strict booleans only: a truthy string must not pass as verification
	const primary = (emails as Partial<GithubEmail>[]).find(
		(entry) =>
			typeof entry === 'object' &&
			entry !== null &&
			typeof entry.email === 'string' &&
			entry.email !== '' &&
			entry.primary === true &&
			entry.verified === true,
	);

	return primary?.email;
};
