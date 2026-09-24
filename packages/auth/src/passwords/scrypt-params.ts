/**
 * Cost parameters of scrypt.
 */
export interface ScryptParams {
	/** log2 of the CPU/memory cost `N`. */
	ln: number;
	/** Block size `r`. */
	r: number;
	/** Parallelisation `p`. */
	p: number;
}

/**
 * The scrypt cost new hashes are made with.
 *
 * @defaultValue `N = 2^17, r = 8, p = 1` — OWASP's recommendation: 128 MiB and about a tenth of a second per hash.
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { ln: 17, r: 8, p: 1 };

/**
 * The longest password accepted, in characters. Long enough for any passphrase or manager-made password, short enough
 * that a megabyte of input cannot be used to make hashing slower.
 *
 * @defaultValue 1024
 */
export const MAX_PASSWORD_LENGTH = 1024;

/**
 * The most memory one verification may take, in bytes: scrypt needs `128 · N · r · p`.
 *
 * @defaultValue 1 GiB — eight times the default cost.
 * @internal
 */
export const MAX_SCRYPT_MEMORY: number = 2 ** 30;

/**
 * Bytes of salt per hash.
 *
 * @internal
 */
export const SALT_BYTES = 16;

/**
 * Bytes of derived key per hash.
 *
 * @internal
 */
export const KEY_BYTES = 32;

/**
 * A stored hash, taken apart.
 *
 * @internal
 */
export interface ParsedHash {
	/** The cost it was made with. */
	params: ScryptParams;
	/** The salt. */
	salt: Buffer;
	/** The derived key. */
	key: Buffer;
}

/**
 * Write a hash in the PHC string format: `$scrypt$ln=17,r=8,p=1$<salt>$<key>`, base64 without padding.
 *
 * The cost travels with the hash, so hashes made with an older cost keep verifying after the default is raised.
 *
 * @param params - The cost.
 * @param salt - The salt.
 * @param key - The derived key.
 * @returns The PHC string.
 * @internal
 */
export const formatHash = (params: ScryptParams, salt: Buffer, key: Buffer): string => {
	// PHC uses standard base64 without the padding
	const encode = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/, '');

	return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${encode(salt)}$${encode(key)}`;
};

/**
 * Take a PHC scrypt string apart.
 *
 * The cost is bounded, so a tampered hash cannot make a verification allocate gigabytes.
 *
 * @param hash - The stored hash.
 * @returns Its parts.
 * @throws Error when the string is not a scrypt hash in the PHC format, or its cost is out of bounds.
 * @internal
 */
export const parseHash = (hash: string): ParsedHash => {
	// Exactly the shape `formatHash` writes; anything else is not a hash of this package
	const match = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(hash);

	if (!match) {
		throw new Error('@novastarter/auth: the password hash is not a scrypt hash in the PHC format');
	}

	// Each factor bounded, and their product too: scrypt needs `128 · N · r · p` bytes, and the factors alone would let
	// a tampered hash ask for tens of gigabytes; the ceiling keeps one verification at a gigabyte at most
	const params = { ln: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };

	if (
		params.ln < 1 ||
		params.ln > 20 ||
		params.r < 1 ||
		params.r > 32 ||
		params.p < 1 ||
		params.p > 16 ||
		128 * 2 ** params.ln * params.r * params.p > MAX_SCRYPT_MEMORY
	) {
		throw new Error('@novastarter/auth: the password hash has a scrypt cost out of bounds');
	}

	return { params, salt: Buffer.from(match[4]!, 'base64'), key: Buffer.from(match[5]!, 'base64') };
};

/**
 * The `maxmem` scrypt needs for a cost, with room to spare.
 *
 * @param params - The cost.
 * @returns Bytes.
 * @internal
 */
export const maxmem = (params: ScryptParams): number => {
	// Node refuses when `128 · N · r` exceeds `maxmem`; twice that leaves room for its own bookkeeping
	return 2 * 128 * 2 ** params.ln * params.r * params.p;
};
