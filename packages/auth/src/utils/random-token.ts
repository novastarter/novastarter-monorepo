import { randomBytes, randomInt } from 'node:crypto';

/**
 * Bytes of randomness in a token {@link randomToken} makes by default.
 *
 * @defaultValue 32 bytes, 256 bits: beyond any guessing, and 43 characters once encoded.
 */
export const DEFAULT_TOKEN_BYTES = 32;

/**
 * A random token for a URL, a cookie or a header: cryptographically strong bytes, base64url without padding.
 *
 * @param bytes - How many random bytes the token carries.
 * @returns The token.
 * @internal
 */
export const randomToken = (bytes: number = DEFAULT_TOKEN_BYTES): string => {
	// 1. base64url needs no escaping in a URL, a cookie or a header, so the token travels as it is
	return randomBytes(bytes).toString('base64url');
};

/**
 * A random code of decimal digits, for a person to type in.
 *
 * @param digits - Length of the code.
 * @returns The code, zero-padded to `digits`.
 * @internal
 */
export const randomDigits = (digits: number): string => {
	// 1. `randomInt` draws without modulo bias, which a byte reduced `% 10` would carry
	let code = '';

	for (let index = 0; index < digits; index++) {
		code += randomInt(10).toString();
	}

	return code;
};
