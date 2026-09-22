import {
	checkToken,
	type CheckTokenOptions,
	type CreatedToken,
	createToken,
	type CreateTokenOptions,
	oneTimeTokenId,
	type TokenRecord,
} from '@novastarter/auth';
import { and, eq } from 'drizzle-orm';
import { useDb } from '../db';
import { authTokens } from '../db/schema';

/**
 * A row of `auth_tokens`, as Drizzle reads it.
 *
 * @internal
 */
type TokenRow = typeof authTokens.$inferSelect;

/**
 * Turn a row into the record `@novastarter/auth` judges: dates become epoch milliseconds, empty columns absent fields.
 *
 * @param row - The row.
 * @returns The record.
 * @internal
 */
const toRecord = (row: TokenRow): TokenRecord => {
	// 1. The package counts in epoch milliseconds; a null user or data is an optional field it leaves out
	return {
		id: row.id,
		purpose: row.purpose,
		createdAt: row.createdAt.getTime(),
		expiresAt: row.expiresAt.getTime(),
		...(row.userId !== null ? { userId: row.userId } : {}),
		...(row.data ? { data: row.data } : {}),
	};
};

/**
 * Make a one-time token — a password reset link, an email confirmation, a sign-in link or code — and store it.
 *
 * A numeric code replaces the user's other tokens of the same purpose, so at most one code is valid at a time and a
 * guess has one target. The two statements are not one transaction — the app's Neon HTTP driver has none — so two
 * codes requested at the same instant may both stay valid until they expire; each is still guarded by the limiter.
 *
 * @param options - Purpose, user, lifetime, data and format.
 * @returns The token to send, shown once, and the stored record.
 * @throws InvalidPayloadError for a `code` without a `userId`, or an empty purpose.
 * @example
 * ```ts
 * const { token } = await issueToken({ purpose: 'password-reset', userId: String(user.id) });
 *
 * await sendMail({ to: user.email, subject: 'Reset your password', text: `https://app.example/reset?token=${token}` });
 * ```
 */
export const issueToken = async (options: CreateTokenOptions): Promise<CreatedToken> => {
	// 1. Made first, so a refused request (no purpose, a code without a user) deletes nothing
	const created = createToken(options);
	const { record } = created;
	const db = useDb();

	// 2. A new code voids the user's earlier codes of the purpose
	if (options.format === 'code' && record.userId !== undefined) {
		await db
			.delete(authTokens)
			.where(and(eq(authTokens.userId, record.userId), eq(authTokens.purpose, record.purpose)));
	}

	// 3. The record alone is stored, keyed by the token's hash
	await db.insert(authTokens).values({
		purpose: record.purpose,
		id: record.id,
		userId: record.userId ?? null,
		createdAt: new Date(record.createdAt),
		expiresAt: new Date(record.expiresAt),
		data: record.data ?? null,
	});

	return created;
};

/**
 * Spend a one-time token: it works exactly once, whatever the verdict.
 *
 * One atomic `DELETE … RETURNING` takes the token out before it is judged, so of two requests with the same token only
 * one gets the row, and an expired or mistyped-purpose token is gone as well.
 *
 * @param purpose - What the token must have been made for.
 * @param token - The token as the client sent it.
 * @param options - The user, for a numeric code: the code is looked up by the pair, and the attempt is charged to the
 * `code` limiter.
 * @returns The record: its user and data.
 * @throws AuthInvalidTokenError when there was no such token, or it expired.
 * @throws HitRateLimitError when a code's user tried too many codes.
 * @example
 * ```ts
 * const { userId } = await spendToken('password-reset', searchParams.get('token') ?? '');
 * ```
 */
export const spendToken = async (
	purpose: string,
	token: string,
	options: CheckTokenOptions = {},
): Promise<TokenRecord> => {
	// 1. The purpose is part of the key: a token of another purpose matches nothing and stays for its own use
	const [row] = await useDb()
		.delete(authTokens)
		.where(and(eq(authTokens.id, oneTimeTokenId(token, options.userId)), eq(authTokens.purpose, purpose)))
		.returning();

	// 2. The package judges what came back — found or not — and charges a code attempt either way
	return checkToken(purpose, row ? toRecord(row) : null, options);
};

/**
 * Void a user's one-time tokens — after a password change, so an old reset link no longer works.
 *
 * @param userId - The user.
 * @param purpose - Only the tokens of this purpose; all of them unless given.
 * @returns How many tokens were voided.
 */
export const revokeTokens = async (userId: string, purpose?: string): Promise<number> => {
	// 1. The purpose narrows the delete only when given
	const where =
		purpose === undefined
			? eq(authTokens.userId, userId)
			: and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose));

	const deleted = await useDb().delete(authTokens).where(where).returning({ id: authTokens.id });

	return deleted.length;
};
