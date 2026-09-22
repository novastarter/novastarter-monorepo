import { InvalidCredentialsError } from '@novastarter/errors';
import { authSettings } from '../lib/settings-access.js';
import { decodeBase32, decrypt } from '../utils/index.js';
import { mfaKey } from './mfa-key.js';
import { matchTotp, TOTP_DIGITS } from './totp.js';

/**
 * What {@link verifyTotp} needs.
 */
export interface VerifyTotpOptions {
	/** The user; the key of the `mfa` limiter. */
	userId: string;
	/** The secret as the application stored it, from `enrollTotp()`. */
	encryptedSecret: string;
	/** Six digits from the app. */
	code: string;
	/**
	 * Record the code's time step as used, atomically and only forward — `UPDATE … SET last_step = $step WHERE
	 * last_step < $step` — and answer whether it moved. A code is then accepted once, and never one older than the last.
	 */
	advance: (step: number) => Promise<boolean>;
}

/**
 * Whether a code looks like a TOTP code rather than a recovery code.
 *
 * @param code - What the user typed.
 * @returns `true` for {@link TOTP_DIGITS} digits.
 * @example
 * ```ts
 * isTotpCode(form.code) ? await verifyTotp({ … }) : await verifyRecoveryCode({ … });
 * ```
 */
export const isTotpCode = (code: string): boolean => {
	// 1. Surrounding spaces are what a pasted code brings along, not part of it
	return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(String(code).trim());
};

/**
 * Check a TOTP code from the app: at enrolment, to confirm it, and at sign-in.
 *
 * Every attempt costs a point of the `mfa` limiter, and a success resets it. The code must match a time step within
 * the window and move the user's last step forward through `advance`, so a code seen over a shoulder is useless a
 * moment later.
 *
 * @param options - The user, the stored secret, the code and the step recorder.
 * @returns The accepted time step.
 * @throws InvalidCredentialsError when the code does not match or its step was used already.
 * @throws HitRateLimitError when the user tried too many codes.
 * @throws Error without a usable `mfa.encryptionKey` in the settings, or when the secret was encrypted with another.
 * @example
 * ```ts
 * await verifyTotp({
 * 	userId,
 * 	encryptedSecret: mfa.secret,
 * 	code: form.code,
 * 	advance: async (step) => (await db.update(authMfa).set({ lastStep: step })
 * 		.where(and(eq(authMfa.userId, userId), lt(authMfa.lastStep, step))).returning()).length > 0,
 * });
 * ```
 */
export const verifyTotp = async (options: VerifyTotpOptions): Promise<number> => {
	const limiter = authSettings().limiters?.mfa;

	// 1. The limiter first, so a wrong guess costs as much as a right one
	await limiter?.consume(options.userId);

	// 2. The secret is decrypted only for the comparison; the step must be new for the user
	const step = matchTotp(
		decodeBase32(decrypt(options.encryptedSecret, mfaKey())),
		String(options.code).trim(),
		Date.now(),
	);

	if (step === null || !(await options.advance(step))) {
		throw new InvalidCredentialsError();
	}

	// 3. A right code clears the count, so a user who mistyped a few times is not locked out afterwards
	await limiter?.delete(options.userId);

	return step;
};
