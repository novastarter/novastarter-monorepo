import { MIN_SECRET_LENGTH } from './settings.js';

/**
 * A secret of the settings, refused when it is missing or too short to be random.
 *
 * @param secret - The value from the settings.
 * @param setting - Its path in the settings, for the error message.
 * @returns The secret.
 * @throws Error when it is missing or shorter than {@link MIN_SECRET_LENGTH}: there is no safe default for a secret,
 * and a short one can be brute-forced offline from anything it signed or encrypted.
 * @internal
 */
export const requireSecret = (secret: string | undefined, setting: string): string => {
	// 1. Refused rather than defaulted, and refused when short: both mistakes would otherwise go unnoticed
	if (!secret || secret.length < MIN_SECRET_LENGTH) {
		throw new Error(`The "${setting}" auth setting must be at least ${MIN_SECRET_LENGTH} characters of random data`);
	}

	return secret;
};

/**
 * A rotatable secret of the settings — one string, or several with the current one first — each held to the bar of
 * {@link requireSecret}.
 *
 * @param secrets - The value from the settings.
 * @param setting - Its path in the settings, for the error message.
 * @returns The secrets, current first.
 * @throws Error when there is none, or any of them is shorter than {@link MIN_SECRET_LENGTH}: an old secret kept for
 * rotation still opens stored values, so it has to be as strong as the current one.
 * @internal
 */
export const requireSecrets = (secrets: string | readonly string[] | undefined, setting: string): string[] => {
	// 1. One string is the common case, a list with no rotation in progress; an empty list is a missing secret
	const list = typeof secrets === 'string' ? [secrets] : [...(secrets ?? [])];

	if (list.length === 0) {
		return [requireSecret(undefined, setting)];
	}

	// 2. Every one checked, the old ones too
	return list.map((secret) => requireSecret(secret, setting));
};
