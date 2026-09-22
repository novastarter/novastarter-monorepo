import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import { MailtrapClient } from 'mailtrap';
import { toMailtrapMail } from './to-mailtrap-mail.js';

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
			...(config.testInboxId !== undefined ? { testInboxId: Number(config.testInboxId) } : {}),
		});
	}

	/**
	 * Send through the Mailtrap API.
	 *
	 * @param message - Rendered message.
	 * @returns The first message id Mailtrap assigned; every recipient as accepted, since the API takes all or
	 * nothing.
	 * @throws The SDK's `MailtrapError` (its message lists Mailtrap's errors) when the API refuses.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. The message is translated before the request, so a missing sender fails by name instead of as an API error;
		// the SDK throws its own `MailtrapError` on refusal, which passes through untouched
		const response = await this.client.send(await toMailtrapMail(message));

		// 2. Mailtrap takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: response.message_ids[0],
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
		};
	}

	/**
	 * Check the token without sending: it has to see at least one account.
	 *
	 * @throws The SDK's error when Mailtrap refuses the token; an error when it has no account.
	 */
	async verify(): Promise<void> {
		// 1. Listing the accounts is the cheapest call that needs the token: a bad one is refused here, without a send
		const accounts = await this.client.general.accounts.getAllAccounts();

		// 2. A token of no account can send nothing
		if (accounts.length === 0) {
			throw new Error('Mailtrap token has access to no account');
		}
	}
}
