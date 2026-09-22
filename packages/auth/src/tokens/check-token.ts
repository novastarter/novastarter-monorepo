import { AuthInvalidTokenError } from '../errors/index.js';
import { authSettings } from '../lib/settings-access.js';
import type { TokenRecord } from '../types.js';

/**
 * Per-call options of {@link checkToken}.
 */
export interface CheckTokenOptions {
	/** The user a numeric code was typed for. Given means the token is a code: the attempt is charged to the limiter. */
	userId?: string | undefined;
}

/**
 * Judge a one-time token the application took out of its table.
 *
 * The application spends the token first — one atomic `DELETE … RETURNING` by `oneTimeTokenId()` — and hands over what
 * came back, found or not, so the token works exactly once whatever the verdict. For a numeric code, every attempt
 * costs a point of the `code` limiter, per purpose and user, so the million codes cannot be tried one by one.
 *
 * @param purpose - What the token must have been made for.
 * @param record - What the delete returned; `undefined` or `null` when nothing matched.
 * @param options - The user, for a numeric code.
 * @returns The record: its user and data.
 * @throws AuthInvalidTokenError when there was no token, it was made for another purpose, or it expired.
 * @throws HitRateLimitError when a code's user tried too many codes.
 * @example
 * ```ts
 * const [found] = await db.delete(authTokens).where(eq(authTokens.id, oneTimeTokenId(token))).returning();
 * const { userId } = await checkToken('password-reset', found);
 * ```
 */
export const checkToken = async (
	purpose: string,
	record: TokenRecord | null | undefined,
	options: CheckTokenOptions = {},
): Promise<TokenRecord> => {
	// 1. Every code attempt is charged, a miss included — without that the limit would only count right guesses
	if (options.userId !== undefined) {
		await authSettings().limiters?.code?.consume(`${purpose}:${options.userId}`);
	}

	// 2. One error for every failed check, so a caller probing tokens learns nothing about which one failed
	if (!record || record.purpose !== purpose || record.expiresAt <= Date.now()) {
		throw new AuthInvalidTokenError();
	}

	return record;
};
