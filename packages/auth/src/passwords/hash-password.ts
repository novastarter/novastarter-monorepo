import { randomBytes, scrypt } from 'node:crypto';
import { InvalidPayloadError } from '@novastarter/errors';
import {
	DEFAULT_SCRYPT_PARAMS,
	formatHash,
	KEY_BYTES,
	MAX_PASSWORD_LENGTH,
	maxmem,
	SALT_BYTES,
	type ScryptParams,
} from './scrypt-params.js';

/**
 * Run scrypt on a password.
 *
 * @param password - The password, normalised.
 * @param salt - The salt.
 * @param params - The cost.
 * @returns The derived key.
 * @internal
 */
export const derive = (password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> => {
	// The callback form runs on libuv's thread pool; the sync one would block the event loop for a tenth of a second
	return new Promise((resolve, reject) => {
		scrypt(
			password,
			salt,
			KEY_BYTES,
			{ N: 2 ** params.ln, r: params.r, p: params.p, maxmem: maxmem(params) },
			(error, key) => (error ? reject(error) : resolve(key)),
		);
	});
};

/**
 * A password in the form it is hashed in, refused when it cannot be.
 *
 * @param password - The password, as typed.
 * @returns The password in Unicode NFKC.
 * @throws InvalidPayloadError when it is not a string, is empty or is longer than {@link MAX_PASSWORD_LENGTH}.
 * @internal
 */
export const normalizePassword = (password: string): string => {
	// Checked before any work: an empty password is no password, a huge one only a way to burn CPU
	if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
		throw new InvalidPayloadError({ reason: `The password must be 1 to ${MAX_PASSWORD_LENGTH} characters long` });
	}

	// NFKC, so the same password typed on two keyboards — a composed and a decomposed "é" — hashes the same
	return password.normalize('NFKC');
};

/**
 * Hash a password with scrypt, for storing in place of the password.
 *
 * Each hash gets a random salt and carries its cost, in the PHC string format — `$scrypt$ln=17,r=8,p=1$…$…` — so it
 * verifies whatever the default cost is later; {@link needsRehash} says when to replace it.
 *
 * @param password - The password, as typed.
 * @param params - The cost; {@link DEFAULT_SCRYPT_PARAMS} unless given.
 * @returns The hash to store.
 * @throws InvalidPayloadError for an empty password or one longer than {@link MAX_PASSWORD_LENGTH}.
 * @example
 * ```ts
 * await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, id));
 * ```
 */
export const hashPassword = async (password: string, params: ScryptParams = DEFAULT_SCRYPT_PARAMS): Promise<string> => {
	// Normalised and bounded first, the same way the verification does it
	const normalized = normalizePassword(password);

	// A fresh salt per hash, so equal passwords get different hashes and no table can be precomputed
	const salt = randomBytes(SALT_BYTES);

	return formatHash(params, salt, await derive(normalized, salt, params));
};
