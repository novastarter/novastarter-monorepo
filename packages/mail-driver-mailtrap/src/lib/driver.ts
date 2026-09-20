import {
	bareMailAddress,
	type MailAddress,
	type MailAttachment,
	type MailDriver,
	type MailMessage,
	type MailResult,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import { type Address, type Attachment, type Mail, MailtrapClient } from 'mailtrap';

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
 * A `MailAddress` the way Mailtrap takes it.
 *
 * @param address - Ours.
 * @returns `{ email, name? }`.
 */
export const toMailtrapAddress = (address: MailAddress): Address =>
	// 1. A display-name string is unwrapped to its address; an object keeps its name
	typeof address === 'string' ? { email: bareMailAddress(address) } : { email: address.address, name: address.name };

/**
 * An attachment the way Mailtrap takes it: the bytes, a type and — inline — the content id.
 *
 * @param attachment - Ours.
 * @returns Mailtrap's.
 * @throws Error when the attachment has neither content nor a path to read.
 */
export const toMailtrapAttachment = async (attachment: MailAttachment): Promise<Attachment> => {
	// 1. The SDK base64-encodes a Buffer itself; a path is read here, like the siblings do
	const content = await readAttachment(attachment);

	// 2. A content id makes the attachment inline, for `cid:` references from the html
	return {
		filename: attachment.filename,
		content,
		disposition: attachment.cid !== undefined ? 'inline' : 'attachment',
		...(attachment.contentType !== undefined ? { type: attachment.contentType } : {}),
		...(attachment.cid !== undefined ? { content_id: attachment.cid } : {}),
	};
};

/**
 * Translate a message into the payload of Mailtrap's `send()`.
 *
 * The category is Mailtrap's own `category`; the tags become a `tags` custom variable, which the message log shows
 * and the webhooks carry.
 *
 * @param message - Ours, with `from` set (`sendMail()` fills it in).
 * @returns Mailtrap's.
 * @throws Error when `from` is missing — Mailtrap requires it.
 */
export const toMailtrapMail = async (message: MailMessage): Promise<Mail> => {
	// 1. The API refuses a message without a sender; say so before the request goes out
	if (!message.from) {
		throw new Error('Mailtrap needs a "from" address');
	}

	// 2. Optional fields are only set when present, so the request carries no `undefined` keys
	const mail = {
		from: toMailtrapAddress(message.from),
		to: toMailAddressList(message.to).map(toMailtrapAddress),
		subject: message.subject,
		category: message.category ?? 'transactional',
		...(message.html !== undefined ? { html: message.html } : {}),
		...(message.text !== undefined ? { text: message.text } : {}),
		...(message.cc ? { cc: message.cc.map(toMailtrapAddress) } : {}),
		...(message.bcc ? { bcc: message.bcc.map(toMailtrapAddress) } : {}),
		...(message.replyTo ? { reply_to: toMailtrapAddress(message.replyTo) } : {}),
		...(message.headers ? { headers: message.headers } : {}),
		...(message.tags?.length ? { custom_variables: { tags: message.tags.join(',') } } : {}),
	} as Mail;

	// 3. Attachments are read in parallel: every one is complete before the request is built
	if (message.attachments?.length) {
		mail.attachments = await Promise.all(message.attachments.map(toMailtrapAttachment));
	}

	return mail;
};

/**
 * Driver for [Mailtrap](https://mailtrap.io), through the official `mailtrap` SDK: the Email Sending API in
 * production, the Email Sandbox for testing.
 *
 * The client is called directly, the way the other API drivers of the kit do, so the category and the tags reach
 * Mailtrap and nodemailer stays out of the package.
 *
 * @example
 * ```ts
 * useMail().registerDriver('mailtrap', MailDriverMailtrap);
 * useMail().registerLocation('main', {
 * 	driver: 'mailtrap',
 * 	options: {
 * 		token: env['MAIL_MAILTRAP_TOKEN'],
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
		const response = await this.client.send(await toMailtrapMail(message));

		// 1. Mailtrap takes a message whole or refuses it, so every recipient counts as accepted
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
		const accounts = await this.client.general.accounts.getAllAccounts();

		// 1. A token of no account can send nothing
		if (accounts.length === 0) {
			throw new Error('Mailtrap token has access to no account');
		}
	}
}

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default MailDriverMailtrap;
