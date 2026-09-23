import { toProviderCallError } from '@novastarter/errors';
import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import { type CallOptions, parseCallMethod } from '@novastarter/utils';
import { httpCall, resolveCallUrl } from '@novastarter/utils/node';
import { MailtrapClient } from 'mailtrap';
import { describeError } from './describe-error.js';
import { toMailtrapMail } from './to-mailtrap-mail.js';

/**
 * How long a {@link MailDriverMailtrap.call} may take unless the caller names another deadline, in milliseconds.
 *
 * @defaultValue 30 seconds.
 */
export const DEFAULT_MAILTRAP_CALL_TIMEOUT = 30_000;

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
	 * The API token, kept for {@link call}, which goes around the SDK since it has no generic request.
	 *
	 * @internal
	 */
	private readonly token: string;

	/**
	 * Create a driver on a client of its own for the given token.
	 *
	 * @param config - Token, sandbox inbox and bulk switch.
	 * @throws Error without a token, with a sandbox but no inbox, or with sandbox and bulk together — the SDK
	 * would refuse the first send for either.
	 */
	constructor(config: MailDriverMailtrapConfig) {
		// 1. Configuration errors are reported by the option's name, before the SDK gets to refuse the first send
		if (!config.token) {
			throw new Error('The mailtrap mail driver needs a "token"');
		}

		if (config.sandbox && config.testInboxId === undefined) {
			throw new Error('The mailtrap mail driver needs a "testInboxId" in sandbox mode');
		}

		if (config.sandbox && config.bulk) {
			throw new Error('The mailtrap mail driver cannot be in sandbox and bulk mode at once');
		}

		// 2. The client picks its host from the flags: sandbox, bulk, or the transactional sending API
		this.client = new MailtrapClient({
			token: config.token,
			sandbox: Boolean(config.sandbox),
			bulk: Boolean(config.bulk),
			...(config.testInboxId !== undefined ? { testInboxId: config.testInboxId } : {}),
		});

		// 3. The token is kept for `call()`, the one request made without the SDK
		this.token = config.token;
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
		// 1. The message is translated before the request, so a failure of the mapper (no sender, unreadable
		//    attachment) surfaces the kit's own error instead of a re-wrapped API error
		const mail = await toMailtrapMail(message);

		let response: Awaited<ReturnType<MailtrapClient['send']>>;

		try {
			response = await this.client.send(mail);
		} catch (error) {
			// 2. The SDK throws its own `MailtrapError` on refusal, its messages listed; wrapped so the log names the
			//    provider, the SDK's error as the cause
			throw describeError(error);
		}

		// 3. Mailtrap takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: response.message_ids[0],
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
		};
	}

	/**
	 * Check the token without sending: it has to see at least one account.
	 *
	 * @throws An error naming Mailtrap with the SDK's error as the cause when Mailtrap refuses the token; an error
	 * when it has no account.
	 */
	async verify(): Promise<void> {
		// 1. Listing the accounts is the cheapest call that needs the token: a bad one is refused here, without a send
		let accounts: Awaited<ReturnType<MailtrapClient['general']['accounts']['getAllAccounts']>>;

		try {
			accounts = await this.client.general.accounts.getAllAccounts();
		} catch (error) {
			throw describeError(error);
		}

		// 2. A token of no account can send nothing
		if (accounts.length === 0) {
			throw new Error('Mailtrap token has access to no account');
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
	 * @param params - The query or the body.
	 * @param options - A timeout ({@link DEFAULT_MAILTRAP_CALL_TIMEOUT} unless given), an abort signal, extra headers,
	 * where the parameters go (`paramsIn`).
	 * @returns Mailtrap's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError when Mailtrap answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Mailtrap answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on Mailtrap's API hosts.
	 * @example
	 * ```ts
	 * const accounts = await useMail().location('mailtrap').call?.('GET /api/accounts');
	 * ```
	 */
	async call<T = unknown>(method: string, params?: Record<string, unknown>, options: CallOptions = {}): Promise<T> {
		// 1. The method is taken apart and its URL checked before any request, so a foreign host never sees the token
		const { verb, target } = parseCallMethod(method);
		const url = resolveCallUrl(MAILTRAP_API_URL, target, MAILTRAP_CALL_HOSTS);

		// 2. The request with the token; the caller's headers go on top of the driver's
		const response = await httpCall({
			url,
			verb,
			params,
			paramsIn: options.paramsIn,
			headers: { authorization: `Bearer ${this.token}`, ...options.headers },
			timeout: options.timeout ?? DEFAULT_MAILTRAP_CALL_TIMEOUT,
			signal: options.signal,
		});

		// 3. A refusal becomes the kit's error; Mailtrap's `errors` or `error` names the reason, and nothing of the
		//    request — the token included — goes into it
		if (response.status < 200 || response.status >= 300) {
			throw toProviderCallError({
				provider: 'mailtrap',
				method,
				status: response.status,
				body: response.body,
				headers: response.headers,
			});
		}

		return response.body as T;
	}
}
