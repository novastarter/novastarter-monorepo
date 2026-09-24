import { AuthInvalidTokenError } from '../errors/index.js';
import { authSettings } from '../lib/settings-access.js';
import type { TokenRecord } from '../types.js';
import { oneTimeTokenId } from './one-time-token-id.js';

/**
 * What {@link checkToken} needs.
 */
export interface CheckTokenOptions {
	/** What the token must have been made for. */
	purpose: string;
	/** The token as the client sent it: a link token, or a numeric code. */
	token: string;
	/** The user a numeric code was typed for. Given means the token is a code: the attempt is charged to the limiter. */
	userId?: string | undefined;
	/**
	 * Take the token out of storage, atomically, and hand back what was taken — `DELETE … WHERE id = $id AND purpose =
	 * $purpose RETURNING *` — or `null` when nothing matched. Of two requests with the same token only one gets the
	 * record, so a token works exactly once whatever the verdict.
	 */
	spend: (id: string, purpose: string) => Promise<TokenRecord | null | undefined>;
}

/**
 * Spend a one-time token: take it out of storage through `spend` and judge what came back.
 *
 * For a numeric code, every attempt costs a point of the `code` limiter, per purpose and user, so the million codes
 * cannot be tried one by one; a right code resets it.
 *
 * @param options - The purpose, the token, the user for a numeric code, and the atomic take-out.
 * @returns The record: its user and data.
 * @throws AuthInvalidTokenError when there was no token, it was made for another purpose, or it expired.
 * @throws HitRateLimitError when a code's user tried too many codes.
 * @example
 * ```ts
 * const { userId } = await checkToken({
 * 	purpose: 'password-reset',
 * 	token,
 * 	spend: async (id, purpose) => (await db.delete(authTokens)
 * 		.where(and(eq(authTokens.id, id), eq(authTokens.purpose, purpose))).returning())[0],
 * });
 * ```
 */
export const checkToken = async (options: CheckTokenOptions): Promise<TokenRecord> => {
	const { purpose, userId } = options;
	const limiter = userId !== undefined ? authSettings().limiters?.code : undefined;
	const limiterKey = `${purpose}:${userId}`;

	// Every code attempt is charged before the lookup, a miss included — without that the limit would only count right
	// guesses
	await limiter?.consume(limiterKey);

	// The id is the package's to compute, so the lookup always matches how `createToken()` keyed the record
	const record = await options.spend(oneTimeTokenId(options.token, userId), purpose);

	// One error for every failed check, so a caller probing tokens learns nothing about which one failed
	if (!record || record.purpose !== purpose || record.expiresAt <= Date.now()) {
		throw new AuthInvalidTokenError();
	}

	// A right code clears the count, so a user who mistyped a few times is not locked out afterwards
	await limiter?.delete(limiterKey);

	return record;
};
