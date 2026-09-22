import { enrollTotp, generateRecoveryCodes, isTotpCode, verifyRecoveryCode, verifyTotp } from '@novastarter/auth';
import { InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';
import { and, count, eq, lt } from 'drizzle-orm';
import { useDb } from '../db';
import { authMfa, authRecoveryCodes } from '../db/schema';

/**
 * What {@link startTotpEnrolment} hands back, for the enrolment screen.
 */
export interface StartedTotpEnrolment {
	/** The secret in base32, for typing in by hand. Shown once; the table keeps it encrypted. */
	secret: string;
	/** The `otpauth://` URI to render as a QR code. */
	uri: string;
}

/**
 * Which second factor {@link verifySecondFactor} accepted.
 */
export type SecondFactor = 'totp' | 'recovery';

/**
 * The step recorder `verifyTotp()` calls: move the user's last accepted time step forward, atomically.
 *
 * @param userId - The user.
 * @returns A function answering whether the step moved.
 * @internal
 */
const advanceStep =
	(userId: string) =>
	async (step: number): Promise<boolean> => {
		// 1. One conditional update: of two requests with the same code only one moves the step, and an older code
		//    never moves it back
		const moved = await useDb()
			.update(authMfa)
			.set({ lastStep: step })
			.where(and(eq(authMfa.userId, userId), lt(authMfa.lastStep, step)))
			.returning({ userId: authMfa.userId });

		return moved.length > 0;
	};

/**
 * Replace a user's recovery codes with a fresh set, so every old code stops working.
 *
 * Two statements rather than a transaction — the app's Neon HTTP driver has none; a failure between them leaves the
 * user without codes, which {@link regenerateRecoveryCodes} repairs, never with old codes still valid.
 *
 * @param userId - The user.
 * @returns The new codes, to show once.
 * @internal
 */
const replaceRecoveryCodes = async (userId: string): Promise<string[]> => {
	const db = useDb();
	const { codes, ids } = generateRecoveryCodes();

	// 1. The old set goes first, so a leaked code is dead even if the insert fails
	await db.delete(authRecoveryCodes).where(eq(authRecoveryCodes.userId, userId));

	// 2. Only the ids are stored; the codes themselves exist on the user's screen alone
	await db.insert(authRecoveryCodes).values(ids.map((id) => ({ userId, id })));

	return codes;
};

/**
 * The user's enrolment, confirmed or pending.
 *
 * @param userId - The user.
 * @returns The row; `undefined` when the user has none.
 * @internal
 */
const findEnrolment = async (userId: string): Promise<typeof authMfa.$inferSelect | undefined> => {
	// 1. One per user: the user id is the key
	const [row] = await useDb().select().from(authMfa).where(eq(authMfa.userId, userId)).limit(1);

	return row;
};

/**
 * Start adding an authenticator app: make a TOTP secret and store it encrypted, unconfirmed.
 *
 * A pending enrolment is replaced — the user may have scanned the code into the wrong app — but a confirmed one is
 * not: otherwise a stolen session could swap the victim's second factor for the thief's. The upsert only updates an
 * unconfirmed row, in one statement, so a confirmation racing it cannot be overwritten.
 *
 * @param userId - The user.
 * @param accountName - What the app shows under the code: usually the email address.
 * @returns The secret and the URI for the QR code.
 * @throws InvalidPayloadError when the user has TOTP confirmed already.
 * @throws Error without a usable `mfa.encryptionKey` in the auth settings.
 */
export const startTotpEnrolment = async (userId: string, accountName: string): Promise<StartedTotpEnrolment> => {
	// 1. A fresh secret; the plain one only travels to the user's screen
	const { secret, uri, encryptedSecret } = enrollTotp({ accountName });
	const createdAt = new Date();

	// 2. Insert, or overwrite a pending enrolment; a confirmed row makes the update match nothing and return no row
	const written = await useDb()
		.insert(authMfa)
		.values({ userId, secret: encryptedSecret, confirmed: false, createdAt, lastStep: 0 })
		.onConflictDoUpdate({
			target: authMfa.userId,
			set: { secret: encryptedSecret, createdAt, lastStep: 0 },
			setWhere: eq(authMfa.confirmed, false),
		})
		.returning({ userId: authMfa.userId });

	if (written.length === 0) {
		throw new InvalidPayloadError({ reason: 'TOTP is already enabled; disable it before enrolling again' });
	}

	return { secret, uri };
};

/**
 * Finish adding an authenticator app: check a code from it, turn TOTP on and hand out recovery codes.
 *
 * @param userId - The user.
 * @param code - Six digits from the app.
 * @returns The recovery codes, to show once.
 * @throws InvalidPayloadError when the user has no pending enrolment.
 * @throws InvalidCredentialsError when the code does not match or was used already.
 * @throws HitRateLimitError when the user tried too many codes.
 */
export const confirmTotpEnrolment = async (userId: string, code: string): Promise<string[]> => {
	// 1. Only a pending enrolment can be confirmed; a confirmed one needs no second confirmation
	const enrolment = await findEnrolment(userId);

	if (!enrolment || enrolment.confirmed) {
		throw new InvalidPayloadError({ reason: 'There is no pending TOTP enrolment to confirm' });
	}

	// 2. The code proves the app holds the secret; its step is recorded, so it cannot sign in afterwards
	await verifyTotp({ userId, encryptedSecret: enrolment.secret, code, advance: advanceStep(userId) });

	// 3. Confirmed only while still pending — a concurrent confirmation or re-enrolment makes this match nothing
	const confirmed = await useDb()
		.update(authMfa)
		.set({ confirmed: true })
		.where(and(eq(authMfa.userId, userId), eq(authMfa.confirmed, false), eq(authMfa.secret, enrolment.secret)))
		.returning({ userId: authMfa.userId });

	if (confirmed.length === 0) {
		throw new InvalidPayloadError({ reason: 'There is no pending TOTP enrolment to confirm' });
	}

	// 4. The recovery codes come with a working second factor, not before
	return replaceRecoveryCodes(userId);
};

/**
 * Check the second factor at sign-in: a TOTP code, or a recovery code, which is spent.
 *
 * @param userId - The user signing in.
 * @param code - What the user typed: six digits, or a recovery code.
 * @returns Which factor was accepted.
 * @throws InvalidCredentialsError when the user has no confirmed TOTP, or the code does not match.
 * @throws HitRateLimitError when the user tried too many codes.
 */
export const verifySecondFactor = async (userId: string, code: string): Promise<SecondFactor> => {
	// 1. Without a confirmed enrolment there is no second factor to pass; the same error as a wrong code
	const enrolment = await findEnrolment(userId);

	if (!enrolment?.confirmed) {
		throw new InvalidCredentialsError();
	}

	// 2. Six digits are a TOTP code, recorded as used so it cannot be replayed
	if (isTotpCode(code)) {
		await verifyTotp({ userId, encryptedSecret: enrolment.secret, code, advance: advanceStep(userId) });

		return 'totp';
	}

	// 3. Anything else is a recovery code, spent by one atomic delete, so two requests with it cannot both pass
	await verifyRecoveryCode({
		userId,
		code,
		spend: async (id) => {
			const spent = await useDb()
				.delete(authRecoveryCodes)
				.where(and(eq(authRecoveryCodes.userId, userId), eq(authRecoveryCodes.id, id)))
				.returning({ id: authRecoveryCodes.id });

			return spent.length > 0;
		},
	});

	return 'recovery';
};

/**
 * Whether a user has TOTP turned on — whether sign-in asks for a second factor.
 *
 * @param userId - The user.
 * @returns `true` for a confirmed enrolment; a pending one protects nothing yet.
 */
export const hasMfa = async (userId: string): Promise<boolean> => {
	// 1. Only the confirmed flag decides
	const enrolment = await findEnrolment(userId);

	return enrolment?.confirmed === true;
};

/**
 * Hand out a fresh set of recovery codes — when the old ones ran low or may have leaked.
 *
 * @param userId - The user.
 * @returns The new codes, to show once.
 * @throws InvalidPayloadError when the user has no confirmed TOTP: codes without a second factor protect nothing.
 */
export const regenerateRecoveryCodes = async (userId: string): Promise<string[]> => {
	// 1. Codes belong to a working second factor
	if (!(await hasMfa(userId))) {
		throw new InvalidPayloadError({ reason: 'TOTP is not enabled' });
	}

	// 2. The old set dies with the new one
	return replaceRecoveryCodes(userId);
};

/**
 * How many unused recovery codes a user has left — to prompt for a new set when few remain.
 *
 * @param userId - The user.
 * @returns The count.
 */
export const countRecoveryCodes = async (userId: string): Promise<number> => {
	// 1. Spent codes are deleted, so every row is an unused code
	const [row] = await useDb()
		.select({ total: count() })
		.from(authRecoveryCodes)
		.where(eq(authRecoveryCodes.userId, userId));

	return row?.total ?? 0;
};

/**
 * Turn TOTP off for a user and drop their recovery codes.
 *
 * The caller decides who may do this — typically only after a fresh second-factor check.
 *
 * @param userId - The user.
 * @returns Once the enrolment and the codes are gone.
 */
export const disableMfa = async (userId: string): Promise<void> => {
	const db = useDb();

	// 1. The enrolment first: once it is gone the codes are no longer accepted, even if their delete fails
	await db.delete(authMfa).where(eq(authMfa.userId, userId));
	await db.delete(authRecoveryCodes).where(eq(authRecoveryCodes.userId, userId));
};
