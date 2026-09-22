import { timingSafeEqual } from 'node:crypto';
import { derive, normalizePassword } from './hash-password.js';
import { parseHash } from './scrypt-params.js';

/**
 * Check a password against a hash {@link hashPassword} made.
 *
 * @param password - The password, as typed.
 * @param hash - The stored hash.
 * @returns Whether the password matches.
 * @throws InvalidPayloadError for an empty password or one longer than the maximum.
 * @throws Error when the stored hash is not a scrypt PHC string — a broken record, not a wrong password.
 * @example
 * ```ts
 * if (!(await verifyPassword(password, user.passwordHash))) throw new InvalidCredentialsError();
 * ```
 */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
	// 1. The stored hash is taken apart first, so a broken record fails loudly rather than as a wrong password
	const parsed = parseHash(hash);

	// 2. The same normalisation and cost as when the hash was made
	const key = await derive(normalizePassword(password), parsed.salt, parsed.params);

	// 3. Compared in constant time; lengths differ only for a hash made with another key length, which cannot match
	return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
};
