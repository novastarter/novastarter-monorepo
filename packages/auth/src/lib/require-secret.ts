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
