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
import { type MailDataRequired, MailService } from '@sendgrid/mail';

/**
 * Options accepted by {@link MailDriverSendgrid}.
 */
export type MailDriverSendgridConfig = {
	/** API key with the `Mail Send` permission (`SG.…`). */
	apiKey: string;
	/** Validate without delivering — SendGrid's sandbox mode. */
	sandbox?: boolean | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `sendgrid` has its options
 * checked against {@link MailDriverSendgridConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		sendgrid: MailDriverSendgridConfig;
	}
}

/**
 * A `MailAddress` the way SendGrid takes it.
 *
 * @param address - Ours.
 * @returns `{ email, name? }`.
 */
export const toSendgridAddress = (address: MailAddress): { email: string; name?: string } =>
	// 1. A display-name string is unwrapped to its address; an object keeps its name
	typeof address === 'string' ? { email: bareMailAddress(address) } : { email: address.address, name: address.name };

/**
 * An attachment the way SendGrid takes it: base64 content, inline when it has a content id.
 *
 * @param attachment - Ours.
 * @returns SendGrid's.
 * @throws Error for an attachment with neither content nor path.
 */
export const toSendgridAttachment = async (
	attachment: MailAttachment,
): Promise<NonNullable<MailDataRequired['attachments']>[number]> => {
	// 1. SendGrid wants the bytes base64-encoded in the request; a path is read here since the API cannot fetch it
	const content = await readAttachment(attachment);

	// 2. A content id makes the attachment inline, for `cid:` references from the html
	return {
		filename: attachment.filename,
		content: content.toString('base64'),
		...(attachment.contentType !== undefined ? { type: attachment.contentType } : {}),
		disposition: attachment.cid !== undefined ? 'inline' : 'attachment',
		...(attachment.cid !== undefined ? { contentId: attachment.cid } : {}),
	};
};

/**
 * Translate a message into SendGrid's `send()` payload.
 *
 * The category and the tags become SendGrid categories.
 *
 * @param message - Ours, with `from` set (`sendMail()` fills it in).
 * @param sandbox - Turn SendGrid's sandbox mode on.
 * @returns SendGrid's.
 * @throws Error when `from` is missing — SendGrid requires it.
 */
export const toSendgridMail = async (message: MailMessage, sandbox = false): Promise<MailDataRequired> => {
	// 1. The API refuses a message without a sender; say so before the request goes out
	if (!message.from) {
		throw new Error('SendGrid needs a "from" address');
	}

	// 2. Optional fields are only set when present, so the request carries no `undefined` keys
	const mail = {
		to: toMailAddressList(message.to).map(toSendgridAddress),
		from: toSendgridAddress(message.from),
		subject: message.subject,
		categories: [message.category ?? 'transactional', ...(message.tags ?? [])],
		...(message.html !== undefined ? { html: message.html } : {}),
		...(message.text !== undefined ? { text: message.text } : {}),
		...(message.cc ? { cc: message.cc.map(toSendgridAddress) } : {}),
		...(message.bcc ? { bcc: message.bcc.map(toSendgridAddress) } : {}),
		...(message.replyTo ? { replyTo: toSendgridAddress(message.replyTo) } : {}),
		...(message.headers ? { headers: message.headers } : {}),
		...(sandbox ? { mailSettings: { sandboxMode: { enable: true } } } : {}),
	} as MailDataRequired;

	// 3. Attachments are read in parallel: every one is encoded in full before the request is built
	if (message.attachments) {
		mail.attachments = await Promise.all(message.attachments.map(toSendgridAttachment));
	}

	return mail;
};

/**
 * Driver for [SendGrid](https://sendgrid.com).
 *
 * Uses its own `MailService` instance rather than the package's default one, so two SendGrid locations with
 * different keys do not share state.
 *
 * @example
 * ```ts
 * useMail().registerDriver('sendgrid', MailDriverSendgrid);
 * useMail().registerLocation('main', {
 * 	driver: 'sendgrid',
 * 	options: {
 * 		apiKey: env['MAIL_SENDGRID_API_KEY'],
 * 	},
 * });
 * ```
 */
export class MailDriverSendgrid implements MailDriver {
	/**
	 * SendGrid's client, bound to the location's key.
	 *
	 * @internal
	 */
	private readonly client: MailService;

	/**
	 * Whether every message is sent in sandbox mode.
	 *
	 * @internal
	 */
	private readonly sandbox: boolean;

	/**
	 * Create a driver on a client of its own for the given key.
	 *
	 * @param config - API key and sandbox switch.
	 * @throws Error without an API key.
	 */
	constructor(config: MailDriverSendgridConfig) {
		// 1. A missing key is a configuration error; report it by the option's name
		if (!config.apiKey) {
			throw new Error('The sendgrid mail driver needs an "apiKey"');
		}

		// 2. A client per location, so two keys never share the package-level default
		this.client = new MailService();
		this.client.setApiKey(config.apiKey);
		this.sandbox = Boolean(config.sandbox);
	}

	/**
	 * Send through the SendGrid API.
	 *
	 * @param message - Rendered message.
	 * @returns SendGrid's message id from the `x-message-id` header; every recipient as accepted.
	 * @throws SendGrid's error (with `response.body` describing the rejection) when the API refuses.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. The API answers with headers only; the message id lives in one of them
		const [response] = await this.client.send(await toSendgridMail(message, this.sandbox));
		const messageId = response.headers['x-message-id'];

		// 2. SendGrid takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: typeof messageId === 'string' ? messageId : undefined,
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
			response: `${response.statusCode}`,
		};
	}
}

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default MailDriverSendgrid;
