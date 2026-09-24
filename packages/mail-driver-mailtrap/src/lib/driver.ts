import { InvalidConfigError } from '@novastarter/errors';
import { type CallOptions, type CallResponse, type HttpApi, request } from '@novastarter/http';
import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import { MailtrapClient } from 'mailtrap';
import { describeError } from './describe-error.js';
import { toMailtrapMail } from './to-mailtrap-mail.js';

/**
 * The root of Mailtrap's general API — accounts, sending domains, contacts, sandbox inboxes — the one
 * {@link MailDriverMailtrap.call} joins a path to.
 *
 * @internal
 */
const MAILTRAP_API_URL = 'https://mailtrap.io';

/**
 * The hosts a full URL in {@link MailDriverMailtrap.call} may point at: the general API and the transactional, bulk and
 * sandbox sending APIs, so the token never travels anywhere else.
 *
 * @internal
 */
const MAILTRAP_CALL_HOSTS: readonly string[] = [
	'mailtrap.io',
	'send.api.mailtrap.io',
	'bulk.api.mailtrap.io',
	'sandbox.api.mailtrap.io',
];

/**
 * Options accepted by {@link MailDriverMailtrap}: the SDK client's own settings.
 */
export type MailDriverMailtrapConfig = {
	/** API token from the Mailtrap dashboard. */
	token: string;
	/** Deliver into the Email Sandbox (a test inbox) rather than to real recipients. */
	sandbox?: boolean | undefined;
	/** Inbox the sandbox delivers into; required with `sandbox`. */
	testInboxId?: number | undefined;
	/** Send through Mailtrap's bulk stream (marketing infrastructure) instead of the transactional one. */
	bulk?: boolean | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `mailtrap` has its options
 * checked against {@link MailDriverMailtrapConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		mailtrap: MailDriverMailtrapConfig;
	}
}

/**
 * Driver for [Mailtrap](https://mailtrap.io), through the official `mailtrap` SDK: the Email Sending API in
 * production, the Email Sandbox for testing.
 *
 * The client is called directly, the way the other API drivers of the kit do, so the category and the tags reach
 * Mailtrap and nodemailer stays out of the package.
 *
 * @example
 * ```ts
 * import { useMail } from '@novastarter/mail';
 * import { MailDriverMailtrap } from '@novastarter/mail-driver-mailtrap';
 * import { env } from './env';
 *
 * const mail = useMail();
 *
 * mail.registerDriver('mailtrap', MailDriverMailtrap);
 * mail.registerLocation('main', {
 * 	driver: 'mailtrap',
 * 	options: {
 * 		token: env.MAIL_MAILTRAP_TOKEN,
 * 		sandbox: true,
 * 		testInboxId: 123456,
 * 	},
 * });
 * ```
 */
export class MailDriverMailtrap implements MailDriver {
	/**
	 * Mailtrap's client, bound to the location's token and mode.
	 *
	 * @internal
	 */
	private readonly client: MailtrapClient;

	/**
	 * Mailtrap's API as {@link MailDriverMailtrap.call} requests it: the token as a bearer token, and Mailtrap's API
	 * hosts as the only ones a full URL may point at.
	 *
	 * @internal
	 */
	private readonly api: HttpApi;

	/**
	 * Create a driver on a client of its own for the given token.
	 *
	 * @param config - Token, sandbox inbox and bulk switch.
	 * @throws InvalidConfigError without a token, with a sandbox but no inbox, or with sandbox and bulk together — the SDK
	 * would refuse the first send for either.
	 */
	constructor(config: MailDriverMailtrapConfig) {
		// Configuration errors are reported by the option's name before the SDK gets to refuse the first send
		if (!config.token) {
			throw new InvalidConfigError({ reason: 'The mailtrap mail driver needs a "token"' });
		}

		if (config.sandbox && config.testInboxId === undefined) {
			throw new InvalidConfigError({ reason: 'The mailtrap mail driver needs a "testInboxId" in sandbox mode' });
		}

		if (config.sandbox && config.bulk) {
			throw new InvalidConfigError({
				reason: 'The mailtrap mail driver cannot be in sandbox and bulk mode at once; turn one off',
			});
		}

		// The client picks its host from the flags: sandbox, bulk, or the transactional sending API
		this.client = new MailtrapClient({
			token: config.token,
			sandbox: Boolean(config.sandbox),
			bulk: Boolean(config.bulk),
			...(config.testInboxId !== undefined ? { testInboxId: config.testInboxId } : {}),
		});

		// `call()` is the one request made without the SDK, so its API gets the token too
		this.api = {
			provider: 'mailtrap',
			baseUrl: MAILTRAP_API_URL,
			hosts: MAILTRAP_CALL_HOSTS,
			headers: { authorization: `Bearer ${config.token}` },
		};
	}

	/**
	 * Send through the Mailtrap API.
	 *
	 * @param message - Rendered message.
	 * @returns The first message id Mailtrap assigned; every recipient as accepted, since the API takes all or
	 * nothing; `response` stays empty, since the API answers no status line.
	 * @throws An error naming Mailtrap with the SDK's `MailtrapError` as the cause (its message lists Mailtrap's
	 * errors) when the API refuses; the mapper's own error unchanged when the message cannot be built.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// Translated before the request, so a mapper failure (no sender, unreadable attachment) surfaces the kit's own
		// error instead of a re-wrapped API error
		const mail = await toMailtrapMail(message);

		let response: Awaited<ReturnType<MailtrapClient['send']>>;

		try {
			response = await this.client.send(mail);
		} catch (error) {
			// The SDK throws its own `MailtrapError` on refusal; it is wrapped so the log names the provider, with the SDK's
			// error as the cause
			throw describeError(error);
		}

		// Mailtrap takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: response.message_ids[0],
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
		};
	}

	/**
	 * Check the token without sending: it has to see at least one account.
	 *
	 * The accounts are listed through the same request as {@link MailDriverMailtrap.call}, not the SDK: the SDK's
	 * `general` API refuses to start without an account id, which the driver has no option for.
	 *
	 * @throws ProviderCallError when Mailtrap refuses the token — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Mailtrap answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws InvalidConfigError when the token has no account.
	 */
	async verify(): Promise<void> {
		// Listing the accounts is the cheapest call that needs the token, so a bad one is refused without a send;
		// `request()` already names Mailtrap in its errors, so they go up unchanged
		const { data: accounts } = await request<unknown[]>(this.api, 'GET /api/accounts');

		// A token of no account can send nothing; a non-array answer is treated the same, since no account is visible
		if (!Array.isArray(accounts) || accounts.length === 0) {
			throw new InvalidConfigError({ reason: 'The mailtrap mail driver needs a "token" with access to an account' });
		}
	}

	/**
	 * Make a request of Mailtrap's own API with the location's token — the way to sending domains, contacts,
	 * suppressions, sandbox inboxes and anything else the driver has no wrapper for.
	 *
	 * `method` is the verb and a path from `https://mailtrap.io` (`GET /api/accounts`), or a full URL on one of
	 * Mailtrap's API hosts: `mailtrap.io`, `send.api.mailtrap.io`, `bulk.api.mailtrap.io`, `sandbox.api.mailtrap.io`.
	 * The parameters are the query of a `GET`, `HEAD` or `DELETE` and the JSON body otherwise. The SDK has no generic
	 * request, so the call is made directly, with the token as a Bearer header.
	 *
	 * @typeParam T - What the request answers with, from Mailtrap's documentation.
	 * @param method - The verb and the path, or a full URL on Mailtrap's API hosts.
	 * @param params - The query or the body. A `{name}` in the path takes the parameter of that name, URL-encoded,
	 * which is then not sent again.
	 * @param options - A timeout (30 s unless given), an abort signal, extra headers.
	 * @returns The status, the lower-cased headers and Mailtrap's answer: parsed JSON, else text; `undefined` when
	 * empty.
	 * @throws ProviderCallError when Mailtrap answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Mailtrap answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on Mailtrap's API hosts.
	 * @example
	 * ```ts
	 * const { data: accounts } = await useMail().location('mailtrap').call!('GET /api/accounts');
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		return request<T>(this.api, method, params, options);
	}
}
