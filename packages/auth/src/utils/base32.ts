/**
 * The RFC 4648 base32 alphabet authenticator apps read secrets in.
 *
 * @internal
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode bytes as RFC 4648 base32 without padding — the form an `otpauth://` URI carries a TOTP secret in.
 *
 * @param bytes - Bytes to encode.
 * @returns Upper-case base32.
 * @internal
 */
export const encodeBase32 = (bytes: Uint8Array): string => {
	let bits = 0;
	let value = 0;
	let output = '';

	// 1. Feed the bytes into a bit buffer and take five bits at a time, one character each
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;

		while (bits >= 5) {
			output += ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}

	// 2. The bits left over are padded with zeros on the right into one last character; the `=` padding is omitted,
	//    since authenticator apps do not want it
	if (bits > 0) {
		output += ALPHABET[(value << (5 - bits)) & 31];
	}

	return output;
};

/**
 * Decode RFC 4648 base32, forgiving case, spaces and padding the way a secret typed by hand comes in.
 *
 * @param text - Base32 text.
 * @returns The bytes.
 * @throws Error on a character outside the alphabet.
 * @internal
 */
export const decodeBase32 = (text: string): Uint8Array => {
	// 1. A secret copied from a screen comes grouped and in any case; neither changes its value
	const clean = text.replace(/[\s=-]/g, '').toUpperCase();
	const bytes: number[] = [];
	let bits = 0;
	let value = 0;

	// 2. Five bits per character into the buffer, a byte out whenever eight are there
	for (const char of clean) {
		const index = ALPHABET.indexOf(char);

		if (index === -1) {
			throw new Error(`Invalid base32 character "${char}"`);
		}

		value = (value << 5) | index;
		bits += 5;

		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}

	// 3. Fewer than eight bits left are the zero padding of the last character, not data
	return Uint8Array.from(bytes);
};
