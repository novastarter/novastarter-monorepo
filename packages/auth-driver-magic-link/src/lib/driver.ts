import {
	type AuthDriver,
	type AuthIdentity,
	AuthInvalidTokenError,
	type ChallengeBegun,
	type ChallengeInput,
	checkToken,
	createToken,
	type TokenFormat,
	type TokenRecord,
} from '@novastarter/auth';
import { InvalidConfigError, InvalidPayloadError } from '@novastarter/errors';

/**
 * The purpose every token of the driver is made and spent under, so a sign-in link cannot be used as a password reset
 * or the other way round.
 *
 * @defaultValue `magic-link`
 */
export const MAGIC_LINK_PURPOSE = 'magic-link';

/**
 * An account the application knows, as {@link AuthDriverMagicLinkConfig.findUser} returns it.
 */
export interface MagicLinkUser {
	/** The user's id; the identity's `subject`. */
	id: string;
}

/**
 * What {@link AuthDriverMagicLinkConfig.send} gets: everything the application needs to write the message.
 */
export interface MagicLinkMessage {
	/** The address to send to, as the person typed it, trimmed. */
	email: string;
	/** The token: the secret of the link, or the six digits of the code. */
	token: string;
	/** Whether to send a link or a code. */
	format: TokenFormat;
	/** The account's id; `undefined` for a sign-up link to an address no account has. */
	userId: string | undefined;
	/** When the token stops being accepted, in milliseconds since the epoch. */
	expiresAt: number;
}

/**
 * Options accepted by {@link AuthDriverMagicLink}.
 */
export type AuthDriverMagicLinkConfig = {
	/** Find the account of an address; `null` when none has it. */
	findUser: (email: string) => Promise<MagicLinkUser | null>;
	/**
	 * Store a token's record, as `createToken()` of `@novastarter/auth` made it. For a code, delete the user's other
	 * codes of the purpose first: a code is keyed by user, so an older one would otherwise stay valid.
	 */
	issue: (record: TokenRecord) => Promise<void>;
	/** Take a record out of storage atomically — `DELETE … RETURNING` — so a token works exactly once. */
	spend: (id: string, purpose: string) => Promise<TokenRecord | null | undefined>;
	/**
	 * Send the link or the code; building the URL and the message is the application's. It runs after `begin()` has
	 * answered — not awaited, so a real account answers as fast as an unknown address — and its errors go to
	 * {@link AuthDriverMagicLinkConfig.onSendError}, not to the caller.
	 */
	send: (message: MagicLinkMessage) => Promise<void>;
	/** Report a failed `send`, which `begin()` no longer waits for; failures are dropped unless given. */
	onSendError?: ((error: unknown, email: string) => void) | undefined;
	/** Send a link to an address no account has, so the person can sign up with it; `false` unless given. */
	signUp?: boolean | undefined;
	/** Lifetime of a link, in milliseconds; the `tokens.ttl` setting of `@novastarter/auth` unless given. */
	ttl?: number | undefined;
	/** Lifetime of a code, in milliseconds; the `tokens.codeTtl` setting of `@novastarter/auth` unless given. */
	codeTtl?: number | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/auth`, so a location naming `magic-link` has its options
 * checked against {@link AuthDriverMagicLinkConfig}.
 */
declare module '@novastarter/auth' {
	interface AuthDrivers {
		'magic-link': AuthDriverMagicLinkConfig;
	}
}

/**
 * Sign-in by a link or a six-digit code sent by mail, the second step of `startChallenge()` / `finishChallenge()`.
 *
 * The package stores nothing: tokens are made by `createToken()` of `@novastarter/auth`, stored by `issue`, sent by
 * `send` and spent by `spend`, all the application's. A link works for any address — with `signUp`, one no account has
 * — and needs no cookie, so it can be opened in another browser than the one that asked. A code is bound to an account
 * and checked against the `code` limiter.
 *
 * @example
 * ```ts
 * auth.registerDriver('magic-link', AuthDriverMagicLink);
 * auth.registerLocation('magic-link', {
 * 	driver: 'magic-link',
 * 	options: { findUser, issue: issueToken, spend: spendToken, send: sendMagicLink },
 * });
 *
 * await startChallenge('magic-link', { identifier: form.email, format: 'link' });
 * const identity = await finishChallenge('magic-link', { input: { token: query.token } });
 * ```
 */
export class AuthDriverMagicLink implements AuthDriver {
	/**
	 * The options the driver was built with.
	 *
	 * @internal
	 */
	private readonly config: AuthDriverMagicLinkConfig;

	/**
	 * Create the driver from its location options.
	 *
	 * @param config - The application's lookup, storage and sender.
	 * @throws InvalidConfigError when a callback is missing: the driver cannot work without any of them.
	 */
	constructor(config: AuthDriverMagicLinkConfig) {
		// Checked here, since the options come from a location config typed loosely enough to leave one out
		for (const name of ['findUser', 'issue', 'spend', 'send'] as const) {
			if (typeof config[name] !== 'function') {
				throw new InvalidConfigError({ reason: `The magic-link driver needs a "${name}" function` });
			}
		}

		this.config = config;
	}

	/**
	 * Make a token for an address, store it and send it.
	 *
	 * Nothing is sent to an address no account has — unless `signUp` allows a link — and nothing is sent as a code to
	 * one, since a code is bound to an account; the answer is the same either way, so it does not tell which addresses
	 * have accounts.
	 *
	 * @param input - `identifier`: the address; `format`: `link` (the default) or `code`.
	 * @returns Nothing for the browser, and no state: the token travels by mail.
	 * @throws InvalidPayloadError when the address is missing or the format is not one of the two.
	 */
	async begin(input: ChallengeInput): Promise<ChallengeBegun> {
		const email = typeof input.identifier === 'string' ? input.identifier.trim() : '';
		const format = input['format'] ?? 'link';

		if (email.length === 0) {
			throw new InvalidPayloadError({ reason: 'An email address is required' });
		}

		if (format !== 'link' && format !== 'code') {
			throw new InvalidPayloadError({ reason: 'The format must be "link" or "code"' });
		}

		// The same empty answer as a success, so the response does not reveal the account
		const user = await this.config.findUser(email);

		if (!user && (format === 'code' || !this.config.signUp)) {
			return {};
		}

		// The address goes in the token's data, so the second step knows who it was for
		const { token, record } = createToken({
			purpose: MAGIC_LINK_PURPOSE,
			userId: user?.id,
			data: { email },
			format,
			ttl: format === 'code' ? this.config.codeTtl : this.config.ttl,
		});

		// Stored before it is sent, so a quick click never finds the token missing
		await this.config.issue(record);

		// The mail is not awaited: a whole mail-provider round trip only for real accounts would let the response time
		// tell which addresses have them. The async wrappers turn a synchronous throw into a rejection too, and the
		// last catch drops a reporter that throws or rejects itself, so neither becomes an unhandled rejection
		void (async () => this.config.send({ email, token, format, userId: user?.id, expiresAt: record.expiresAt }))()
			.catch(async (error: unknown) => this.config.onSendError?.(error, email))
			.catch(() => {});

		return {};
	}

	/**
	 * Spend the token of a link, or the code typed for an address, and answer with the identity.
	 *
	 * @param input - `token`: the link's token or the code; `identifier`: the address, for a code only.
	 * @returns The account's identity; for a sign-up link, the address as `subject` and `raw.signUp` set, so the
	 * application creates the account.
	 * @throws AuthInvalidTokenError when the token is missing, unknown, spent, expired, or the address has no account.
	 * @throws HitRateLimitError when a code's user tried too many codes.
	 */
	async complete(input: ChallengeInput): Promise<AuthIdentity> {
		const token = input['token'];

		if (typeof token !== 'string' || token.length === 0) {
			throw new AuthInvalidTokenError();
		}

		// With an address it is a code, keyed by the account and checked against the `code` limiter; without one it is
		// a link, keyed by the token alone
		let record: TokenRecord;

		if (typeof input.identifier === 'string') {
			const user = await this.config.findUser(input.identifier.trim());

			if (!user) {
				throw new AuthInvalidTokenError();
			}

			record = await checkToken({ purpose: MAGIC_LINK_PURPOSE, token, userId: user.id, spend: this.config.spend });
		} else {
			record = await checkToken({ purpose: MAGIC_LINK_PURPOSE, token, spend: this.config.spend });
		}

		// The address reached the mailbox, so it is verified; a link made without an account is a sign-up, and the
		// application's storage may hand the missing user back as `null`, hence the falsy check
		const email = String(record.data?.['email'] ?? '');

		if (!record.userId) {
			return { provider: 'magic-link', subject: email, email, emailVerified: true, raw: { signUp: true } };
		}

		return { provider: 'magic-link', subject: record.userId, email, emailVerified: true };
	}
}
