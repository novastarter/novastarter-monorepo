import { InvalidPayloadError } from '@novastarter/errors';
import { authSettings } from '../lib/settings-access.js';
import { DEFAULT_CODE_TTL, DEFAULT_TOKEN_TTL } from '../lib/settings.js';
import type { TokenRecord } from '../types.js';
import { randomDigits, randomToken } from '../utils/index.js';
import { oneTimeTokenId } from './one-time-token-id.js';

/**
 * Digits of a one-time numeric code.
 *
 * @defaultValue 6
 */
export const CODE_DIGITS = 6;

/**
 * What a one-time token looks like.
 *
 * - `link`: 256 random bits, base64url — for a link in an email.
 * - `code`: {@link CODE_DIGITS} digits — for a person to type in.
 */
export type TokenFormat = 'link' | 'code';

/**
 * What {@link createToken} needs.
 */
export interface CreateTokenOptions {
	/** What the token is for: `password-reset`, `email-confirm`, `sign-in`; it is only accepted for that. */
	purpose: string;
	/** Who the token is for. Required for a `code`, which is only unique per user. */
	userId?: string | undefined;
	/** Lifetime in milliseconds; the settings' `tokens.ttl` or `tokens.codeTtl` unless given. */
	ttl?: number | undefined;
	/** What to keep with the token: the address to confirm, the page to return to. */
	data?: Record<string, unknown> | undefined;
	/** `link` unless given. */
	format?: TokenFormat | undefined;
}

/**
 * What {@link createToken} hands back.
 */
export interface CreatedToken {
	/** The token to send; it is not stored anywhere. */
	token: string;
	/** The record for the application to store. */
	record: TokenRecord;
}

/**
 * Make a one-time token — a password reset link, an email confirmation, a sign-in link or code; the application
 * stores the record.
 *
 * The record keeps the token's hash only; `checkToken()` judges it once the application took it out of its table.
 * Before storing a `code`, the application deletes the user's other tokens of the same purpose, so at most one code is
 * valid at a time and a guess has one target.
 *
 * @param options - Purpose, user, lifetime, data and format.
 * @returns The token to send and the record to store.
 * @throws InvalidPayloadError for a `code` without a `userId`, or an empty purpose.
 * @example
 * ```ts
 * const { token, record } = createToken({ purpose: 'password-reset', userId: user.id });
 *
 * await db.insert(authTokens).values(record);
 * await sendMail({ to: user.email, subject: 'Reset your password', text: `https://app.example/reset?token=${token}` });
 * ```
 */
export const createToken = (options: CreateTokenOptions): CreatedToken => {
	const format = options.format ?? 'link';

	// 1. A purpose is what keeps a reset token from confirming an email; a code needs its user to be unique
	if (!options.purpose) {
		throw new InvalidPayloadError({ reason: 'A token needs a purpose' });
	}

	if (format === 'code' && !options.userId) {
		throw new InvalidPayloadError({ reason: 'A one-time code needs a userId' });
	}

	// 2. The token for the caller, its hash for the record; a code is shorter-lived, since it is easier to guess
	const settings = authSettings().tokens ?? {};
	const token = format === 'code' ? randomDigits(CODE_DIGITS) : randomToken();
	const now = Date.now();

	const ttl =
		options.ttl ?? (format === 'code' ? (settings.codeTtl ?? DEFAULT_CODE_TTL) : (settings.ttl ?? DEFAULT_TOKEN_TTL));

	return {
		token,
		record: {
			id: oneTimeTokenId(token, format === 'code' ? options.userId : undefined),
			purpose: options.purpose,
			createdAt: now,
			expiresAt: now + ttl,
			...(options.userId !== undefined ? { userId: options.userId } : {}),
			...(options.data ? { data: options.data } : {}),
		},
	};
};
