import { createHmac } from 'node:crypto';

/**
 * Seconds per TOTP time step.
 *
 * @defaultValue 30 — what every authenticator app uses.
 */
export const TOTP_PERIOD = 30;

/**
 * Digits of a TOTP code.
 *
 * @defaultValue 6 — what every authenticator app shows.
 */
export const TOTP_DIGITS = 6;

/**
 * Time steps accepted on either side of the current one, for clocks that drift and codes typed as they roll over.
 *
 * @defaultValue 1 — RFC 6238's recommendation: a code works for up to 90 seconds.
 */
export const TOTP_WINDOW = 1;

/**
 * The time step a moment falls in.
 *
 * @param now - Epoch milliseconds.
 * @returns The step: whole periods since the epoch.
 * @internal
 */
export const totpStep = (now: number): number => {
	// RFC 6238: T = floor((time − T0) / X), with T0 = 0 and X the period
	return Math.floor(now / 1000 / TOTP_PERIOD);
};

/**
 * The HOTP code of a counter (RFC 4226) — TOTP is HOTP of the time step.
 *
 * @param secret - The shared secret.
 * @param counter - The counter.
 * @returns The code, zero-padded to {@link TOTP_DIGITS}.
 * @internal
 */
export const hotp = (secret: Uint8Array, counter: number): string => {
	// The counter as an 8-byte big-endian integer, HMAC-SHA1'd with the secret — SHA-1 is what authenticator apps
	// implement, and within HMAC it is not weakened by SHA-1's collisions
	const message = Buffer.alloc(8);

	message.writeBigUInt64BE(BigInt(counter));

	const digest = createHmac('sha1', secret).update(message).digest();

	// Dynamic truncation: four bytes at the offset the last nibble names, the top bit masked off
	const offset = digest[digest.length - 1]! & 0x0f;
	const binary = digest.readUInt32BE(offset) & 0x7fffffff;

	return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
};

/**
 * Find the time step a TOTP code belongs to, within the window around a moment.
 *
 * @param secret - The shared secret.
 * @param code - The code, as typed.
 * @param now - Epoch milliseconds.
 * @returns The step the code is for; `null` when it matches none.
 * @internal
 */
export const matchTotp = (secret: Uint8Array, code: string, now: number): number | null => {
	// Every step of the window is computed, so the time taken does not tell which one matched
	const current = totpStep(now);
	let matched: number | null = null;

	for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
		if (hotp(secret, step) === code) {
			matched = step;
		}
	}

	return matched;
};

/**
 * The `otpauth://` URI an authenticator app reads from a QR code.
 *
 * @param secret - The secret, base32.
 * @param issuer - The application's name.
 * @param accountName - The account, usually the email address.
 * @returns The URI.
 * @internal
 */
export const otpauthUri = (secret: string, issuer: string, accountName: string): string => {
	// The issuer goes into both the label and the parameter: older apps read one, newer ones the other
	const label = encodeURIComponent(`${issuer}:${accountName}`);

	const params = new URLSearchParams({
		secret,
		issuer,
		algorithm: 'SHA1',
		digits: String(TOTP_DIGITS),
		period: String(TOTP_PERIOD),
	});

	return `otpauth://totp/${label}?${params.toString()}`;
};
