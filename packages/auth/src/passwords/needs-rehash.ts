import { DEFAULT_SCRYPT_PARAMS, parseHash, type ScryptParams } from './scrypt-params.js';

/**
 * Whether a stored hash was made with another cost than the current one, and should be replaced.
 *
 * Called after a successful sign-in, when the password is at hand: the new hash is made from it and stored, so the
 * cost of old accounts follows the default up without asking anyone to reset their password.
 *
 * @param hash - The stored hash.
 * @param params - The current cost; {@link DEFAULT_SCRYPT_PARAMS} unless given.
 * @returns `true` when the hash should be replaced.
 * @throws Error when the stored hash is not a scrypt PHC string.
 * @example
 * ```ts
 * if (needsRehash(user.passwordHash)) await savePasswordHash(user.id, await hashPassword(password));
 * ```
 */
export const needsRehash = (hash: string, params: ScryptParams = DEFAULT_SCRYPT_PARAMS): boolean => {
	// 1. Any difference counts, a lower cost as well as a higher one: the configured cost is the one wanted
	const current = parseHash(hash).params;

	return current.ln !== params.ln || current.r !== params.r || current.p !== params.p;
};
