import { randomBytes } from 'node:crypto';
import { InvalidCredentialsError } from '@novastarter/errors';
import { authSettings } from '../lib/settings-access.js';
import { encodeBase32, hashToken } from '../utils/index.js';

/**
 * How many recovery codes a user gets.
 *
 * @defaultValue 10
 */
export const RECOVERY_CODE_COUNT = 10;

/**
 * What {@link generateRecoveryCodes} hands back.
 */
export interface RecoveryCodes {
	/** The codes to show the user, once: `xxxxx-xxxxx`. */
	codes: string[];
	/** Their ids, for the application to store in place of the codes. */
	ids: string[];
}

/**
 * What {@link verifyRecoveryCode} needs.
 */
export interface VerifyRecoveryCodeOptions {
	/** The user; the key of the `mfa` limiter. */
	userId: string;
	/** The code as typed. */
	code: string;
	/** Delete the code with this id, atomically, and answer whether there was one — `DELETE … RETURNING`. */
	spend: (id: string) => Promise<boolean>;
}

/**
 * The id of a recovery code: its SHA-256 in canonical form — lower case, no dashes or spaces.
 *
 * @param code - The code, as shown or as typed.
 * @returns The id.
 */
export const recoveryCodeId = (code: string): string => {
	// People type codes with or without the dash and in any case; none of it is part of the code
	return hashToken(String(code).replace(/[\s-]/g, '').toLowerCase());
};

/**
 * Make a fresh set of recovery codes: when TOTP is confirmed, and when the old ones ran low or may have leaked.
 *
 * The application stores the ids in place of the old set, so every old code stops working at once.
 *
 * @returns The codes to show once and the ids to store.
 * @example
 * ```ts
 * const { codes, ids } = generateRecoveryCodes();
 *
 * await db.delete(authRecoveryCodes).where(eq(authRecoveryCodes.userId, userId));
 * await db.insert(authRecoveryCodes).values(ids.map((id) => ({ userId, id })));
 * ```
 */
export const generateRecoveryCodes = (): RecoveryCodes => {
	// Ten base32 characters from 50 random bits, split in two for reading; far beyond guessing with a limiter on
	const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
		const text = encodeBase32(randomBytes(7)).slice(0, 10).toLowerCase();

		return `${text.slice(0, 5)}-${text.slice(5)}`;
	});

	return { codes, ids: codes.map(recoveryCodeId) };
};

/**
 * Spend a recovery code at sign-in, instead of a TOTP code.
 *
 * Every attempt costs a point of the `mfa` limiter — the same budget as TOTP codes — and a success resets it.
 *
 * @param options - The user, the code and the spender.
 * @returns Once the code is spent.
 * @throws InvalidCredentialsError when the user has no such code.
 * @throws HitRateLimitError when the user tried too many codes.
 */
export const verifyRecoveryCode = async (options: VerifyRecoveryCodeOptions): Promise<void> => {
	const limiter = authSettings().limiters?.mfa;

	// Charged before the lookup, so a wrong guess costs as much as a right one
	await limiter?.consume(options.userId);

	// The application's atomic delete decides: of two requests with the same code, one spends it
	if (!(await options.spend(recoveryCodeId(options.code)))) {
		throw new InvalidCredentialsError();
	}

	await limiter?.delete(options.userId);
};
