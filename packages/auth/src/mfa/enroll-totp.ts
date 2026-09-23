import { randomBytes } from 'node:crypto';
import { authSettings } from '../lib/settings-access.js';
import { encodeBase32, encrypt } from '../utils/index.js';
import { mfaKeys } from './mfa-key.js';
import { otpauthUri } from './totp.js';

/**
 * Bytes of a TOTP secret.
 *
 * @defaultValue 20 — 160 bits, RFC 4226's recommendation for HMAC-SHA1.
 */
export const TOTP_SECRET_BYTES = 20;

/**
 * Per-call options of {@link enrollTotp}.
 */
export interface EnrollTotpOptions {
	/** The account name the authenticator app shows: usually the user's email address. */
	accountName: string;
}

/**
 * What {@link enrollTotp} hands back.
 */
export interface TotpEnrolment {
	/** The secret in base32, for typing in by hand. Shown once, never stored as is. */
	secret: string;
	/** The `otpauth://` URI to render as a QR code. */
	uri: string;
	/** The secret encrypted with the current `mfa.encryptionKey`, for the application to store. */
	encryptedSecret: string;
}

/**
 * Make a TOTP secret for a user to add to an authenticator app; the application stores it encrypted, unconfirmed.
 *
 * Nothing is protected yet: the application marks the enrolment confirmed once `verifyTotp()` accepted a code from the
 * app, and hands out recovery codes then. It refuses a new enrolment while a confirmed one exists — otherwise a stolen
 * session could swap the victim's second factor for the thief's.
 *
 * @param options - The account name for the app.
 * @returns The secret, the URI for the QR code and the encrypted secret to store.
 * @throws Error without a usable `mfa.encryptionKey` in the settings.
 * @example
 * ```ts
 * const { uri, secret, encryptedSecret } = enrollTotp({ accountName: user.email });
 *
 * await db.insert(authMfa).values({ userId, secret: encryptedSecret, confirmed: false, lastStep: 0 });
 * ```
 */
export const enrollTotp = (options: EnrollTotpOptions): TotpEnrolment => {
	// 1. A fresh 160-bit secret, encrypted for storage; the plain one only travels to the user's screen
	const secret = encodeBase32(randomBytes(TOTP_SECRET_BYTES));

	return {
		secret,
		uri: otpauthUri(secret, authSettings().mfa?.issuer ?? 'Novastarter', options.accountName),
		encryptedSecret: encrypt(secret, mfaKeys()[0]!, 'totp-secret'),
	};
};
