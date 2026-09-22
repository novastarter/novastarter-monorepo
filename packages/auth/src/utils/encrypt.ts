import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Prefix of the format {@link encrypt} writes, so a later format can be told apart.
 *
 * @internal
 */
const VERSION = 'v1';

/**
 * The AES-256 key for a secret of any form: its SHA-256.
 *
 * The application hands the key in as a string — base64, hex, a passphrase from a secret manager — and hashing it
 * gives 32 bytes whatever its form; the strength is the secret's own, so it has to be random and long.
 *
 * @param secret - The application's encryption secret.
 * @returns A 32-byte key.
 * @internal
 */
const deriveKey = (secret: string): Buffer => {
	// 1. Hashing accepts any encoding of the secret without asking the application which one it used
	return createHash('sha256').update(secret, 'utf8').digest();
};

/**
 * Encrypt a string with AES-256-GCM, so it can be stored where a database dump could expose it.
 *
 * @param plaintext - What to hide.
 * @param secret - The application's encryption secret.
 * @returns `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 * @internal
 */
export const encrypt = (plaintext: string, secret: string): string => {
	// 1. A fresh 96-bit IV per message: GCM must never reuse one under the same key
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

	// 2. The tag is what detects tampering on decrypt, so it travels with the ciphertext
	return [
		VERSION,
		iv.toString('base64url'),
		cipher.getAuthTag().toString('base64url'),
		ciphertext.toString('base64url'),
	].join('.');
};

/**
 * Decrypt what {@link encrypt} wrote.
 *
 * @param payload - The encrypted string.
 * @param secret - The secret it was encrypted with.
 * @returns The plaintext.
 * @throws Error when the payload is not in the format, was tampered with, or the secret is another one.
 * @internal
 */
export const decrypt = (payload: string, secret: string): string => {
	// 1. The format is checked before any cryptography, so a wrong value fails with a message that says so
	const [version, iv, tag, ciphertext] = payload.split('.');

	if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
		throw new Error('The encrypted value is not in a known format');
	}

	// 2. GCM verifies the tag in `final()`: a changed byte or another key throws there rather than returning garbage
	const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64url'));

	decipher.setAuthTag(Buffer.from(tag, 'base64url'));

	return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
};
