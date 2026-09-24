import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Prefix of the format {@link encrypt} writes, so a later format can be told apart.
 *
 * `v2` derives the key with HKDF per purpose; `v1`, a plain SHA-256 of the secret, is no longer read.
 *
 * @internal
 */
const VERSION = 'v2';

/**
 * Length in bytes of the GCM authentication tag {@link encrypt} writes and {@link decrypt} requires.
 *
 * GCM also accepts shorter tags, down to 4 bytes, and each byte dropped makes a forgery 256 times cheaper. The payload
 * often comes from a cookie the client controls, so the length is pinned instead of taken from the payload.
 *
 * @defaultValue 16 bytes, the full 128-bit tag.
 * @internal
 */
const AUTH_TAG_LENGTH = 16;

/**
 * What an encrypted value is for; each purpose gets a key of its own from the same secret.
 *
 * @internal
 */
export type EncryptionPurpose = 'oauth-cookie' | 'challenge-cookie' | 'totp-secret';

/**
 * What {@link decrypt} hands back.
 *
 * @internal
 */
export interface DecryptedValue {
	/** The plaintext. */
	plaintext: string;
	/** Position of the secret that opened it; `0` is the current one, higher is an older one kept for rotation. */
	keyIndex: number;
}

/**
 * The AES-256 key for a secret and a purpose: HKDF-SHA256 of the secret, with the purpose as `info`.
 *
 * The application hands the secret in as a string — base64, hex, a passphrase from a secret manager — and HKDF gives
 * 32 bytes whatever its form. The purpose separates the keys: one secret set for both the OAuth cookie and the TOTP
 * secrets still yields two unrelated keys, so a value of one can never be opened as the other. The strength is the
 * secret's own, so it has to be random and long.
 *
 * @param secret - The application's encryption secret.
 * @param purpose - What the key encrypts.
 * @returns A 32-byte key.
 * @internal
 */
const deriveKey = (secret: string, purpose: EncryptionPurpose): Buffer => {
	// No salt: the secret is already random, and HKDF with an empty salt is its standard extract step
	return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `novastarter-auth/${purpose}`, 32));
};

/**
 * Encrypt a string with AES-256-GCM, so it can be stored where a database dump could expose it.
 *
 * @param plaintext - What to hide.
 * @param secret - The application's current encryption secret.
 * @param purpose - What the value is for; {@link decrypt} must be given the same one.
 * @returns `v2.<iv>.<tag>.<ciphertext>`, each part base64url.
 * @internal
 */
export const encrypt = (plaintext: string, secret: string, purpose: EncryptionPurpose): string => {
	// A fresh 96-bit IV per message: GCM must never reuse one under the same key
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, purpose), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

	// The tag is what detects tampering on decrypt, so it travels with the ciphertext
	return [
		VERSION,
		iv.toString('base64url'),
		cipher.getAuthTag().toString('base64url'),
		ciphertext.toString('base64url'),
	].join('.');
};

/**
 * Decrypt what {@link encrypt} wrote, trying the current secret first and the older ones after it.
 *
 * Several secrets make rotation possible: the new secret goes first and encrypts from then on, the old ones stay
 * behind it until every value they encrypted is re-encrypted or has expired. `keyIndex` tells the caller which one
 * opened the value, so it can re-encrypt a value still under an old secret.
 *
 * @param payload - The encrypted string.
 * @param secrets - The secrets, current first.
 * @param purpose - What the value is for, as given to {@link encrypt}.
 * @returns The plaintext and the position of the secret that opened it.
 * @throws Error when the payload is not in the format (a tag other than 16 bytes included), was tampered with, or none
 * of the secrets opens it.
 * @internal
 */
export const decrypt = (payload: string, secrets: readonly string[], purpose: EncryptionPurpose): DecryptedValue => {
	// The format is checked before any cryptography, so a wrong value fails with a message that says so
	const [version, iv, tag, ciphertext, extra] = payload.split('.');

	if (version !== VERSION || !iv || !tag || ciphertext === undefined || extra !== undefined) {
		throw new Error('@novastarter/auth: the encrypted value is not in a known format');
	}

	// Only the full tag is accepted: GCM would verify a truncated one, and a 4-byte tag is forged in 2^32 guesses
	const authTag = Buffer.from(tag, 'base64url');

	if (authTag.length !== AUTH_TAG_LENGTH) {
		throw new Error('@novastarter/auth: the encrypted value is not in a known format');
	}

	// GCM verifies the tag in `final()`: another key throws there, so each secret is tried in turn until one opens it
	for (const [keyIndex, secret] of secrets.entries()) {
		const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, purpose), Buffer.from(iv, 'base64url'), {
			authTagLength: AUTH_TAG_LENGTH,
		});

		decipher.setAuthTag(authTag);

		try {
			const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);

			return { plaintext: plaintext.toString('utf8'), keyIndex };
		} catch {
			continue;
		}
	}

	// No secret opened it: tampered with, or encrypted under a secret no longer configured
	throw new Error('@novastarter/auth: the encrypted value does not open with any of the configured secrets');
};
