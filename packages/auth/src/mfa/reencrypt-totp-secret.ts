import { decrypt, encrypt } from '../utils/index.js';
import { mfaKeys } from './mfa-key.js';

/**
 * Re-encrypt a stored TOTP secret under the current `mfa.encryptionKey`, when it is still under an older one.
 *
 * The step of a key rotation: with the new key first in `mfa.encryptionKey` and the old one behind it, the application
 * runs every stored secret through this and writes back what is not `null`. Once none is left under the old key, the
 * old key can leave the settings.
 *
 * @param encryptedSecret - The secret as the application stored it.
 * @returns The secret encrypted under the current key; `null` when it already is.
 * @throws InvalidConfigError without a usable `mfa.encryptionKey` in the settings.
 * @throws Error when the secret opens with none of its keys.
 * @example
 * ```ts
 * for (const row of await db.select().from(authMfa)) {
 * 	const secret = reencryptTotpSecret(row.secret);
 *
 * 	if (secret !== null) {
 * 		await db.update(authMfa).set({ secret }).where(eq(authMfa.userId, row.userId));
 * 	}
 * }
 * ```
 */
export const reencryptTotpSecret = (encryptedSecret: string): string | null => {
	// Opened with any of the keys; the position says whether it was the current one
	const keys = mfaKeys();
	const { plaintext, keyIndex } = decrypt(encryptedSecret, keys, 'totp-secret');

	// Already under the current key: nothing to write back
	if (keyIndex === 0) {
		return null;
	}

	return encrypt(plaintext, keys[0]!, 'totp-secret');
};
