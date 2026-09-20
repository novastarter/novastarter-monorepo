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
import { Client, type SendEmailV3_1 } from 'node-mailjet';

/**
 * Options accepted by {@link MailDriverMailjet}.
 */
export type MailDriverMailjetConfig = {
	/** Public API key. */
	apiKey: string;
	/** Private API key. */
	apiSecret: string;
	/** Validate without delivering — Mailjet's sandbox mode. */
	sandbox?: boolean | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `mailjet` has its options
 * checked against {@link MailDriverMailjetConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		mailjet: MailDriverMailjetConfig;
	}
}

/**
 * An attachment the way Mailjet takes it.
 */
export type MailjetAttachment = { ContentType: string; Filename: string; Base64Content: string; ContentID?: string };

/**
 * A `MailAddress` the way Mailjet takes it.
 *
 * @param address - Ours.
 * @returns `{ Email, Name? }`.
 */
export const toMailjetAddress = (address: MailAddress): { Email: string; Name?: string } =>
	// 1. A display-name string is unwrapped to its address; an object keeps its name
	typeof address === 'string' ? { Email: bareMailAddress(address) } : { Email: address.address, Name: address.name };

/**
 * An attachment the way Mailjet takes it: base64 content and a content type.
 *
 * @param attachment - Ours.
 * @returns Mailjet's, with `ContentID` when inline.
 * @throws Error when the attachment has neither content nor a path to read.
 */
export const toMailjetAttachment = async (attachment: MailAttachment): Promise<MailjetAttachment> => {
	// 1. Mailjet wants base64 in the request and a content type on every attachment
	const content = await readAttachment(attachment);

	// 2. The content id marks the attachment as inline; `toMailjetMessage` sorts on it
	return {
		ContentType: attachment.contentType ?? 'application/octet-stream',
		Filename: attachment.filename,
		Base64Content: content.toString('base64'),
		...(attachment.cid !== undefined ? { ContentID: attachment.cid } : {}),
	};
};

/**
 * Translate a message into one entry of Mailjet's `Messages`.
 *
 * The category becomes `CustomCampaign`, the tags `CustomID` (joined), which Mailjet's statistics group by.
 *
 * @param message - Ours, with `from` set (`sendMail()` fills it in).
 * @returns Mailjet's.
 * @throws Error when `from` is missing — Mailjet requires it.
 */
export const toMailjetMessage = async (message: MailMessage): Promise<SendEmailV3_1.Message> => {
	// 1. The API refuses a message without a sender; say so before the request goes out
	if (!message.from) {
		throw new Error('Mailjet needs a "from" address');
	}

	// 2. Attachments are read in parallel, then inline ones (with a content id) go to their own list on Mailjet
	const attachments = await Promise.all((message.attachments ?? []).map(toMailjetAttachment));
	const inline = attachments.filter((attachment) => attachment.ContentID !== undefined);
	const regular = attachments.filter((attachment) => attachment.ContentID === undefined);

	// 3. Optional fields are only set when present, so the request carries no `undefined` keys
	return {
		From: toMailjetAddress(message.from),
		To: toMailAddressList(message.to).map(toMailjetAddress),
		Subject: message.subject,
		CustomCampaign: message.category ?? 'transactional',
		...(message.tags?.length ? { CustomID: message.tags.join(',') } : {}),
		...(message.cc ? { Cc: message.cc.map(toMailjetAddress) } : {}),
		...(message.bcc ? { Bcc: message.bcc.map(toMailjetAddress) } : {}),
		...(message.replyTo ? { ReplyTo: toMailjetAddress(message.replyTo) } : {}),
		...(message.html !== undefined ? { HTMLPart: message.html } : {}),
		...(message.text !== undefined ? { TextPart: message.text } : {}),
		...(message.headers ? { Headers: message.headers } : {}),
		...(regular.length ? { Attachments: regular } : {}),
		...(inline.length ? { InlinedAttachments: inline } : {}),
	} as SendEmailV3_1.Message;
};

/**
 * Driver for [Mailjet](https://www.mailjet.com), Send API v3.1.
 *
 * @example
 * ```ts
 * useMail().registerDriver('mailjet', MailDriverMailjet);
 * useMail().registerLocation('main', {
 * 	driver: 'mailjet',
 * 	options: {
 * 		apiKey: env['MAIL_MAILJET_API_KEY'],
 * 		apiSecret: env['MAIL_MAILJET_API_SECRET'],
 * 	},
 * });
 * ```
 */
export class MailDriverMailjet implements MailDriver {
	/**
	 * Mailjet's client, bound to the location's key pair.
	 *
	 * @internal
	 */
	private readonly client: Client;

	/**
	 * Whether every message is sent in sandbox mode.
	 *
	 * @internal
	 */
	private readonly sandbox: boolean;

	/**
	 * Create a driver on a client of its own for the given key pair.
	 *
	 * @param config - API key pair and sandbox switch.
	 * @throws Error without both keys.
	 */
	constructor(config: MailDriverMailjetConfig) {
		// 1. Both keys are needed for a request; a missing one is reported by the options' names
		if (!config.apiKey || !config.apiSecret) {
			throw new Error('The mailjet mail driver needs "apiKey" and "apiSecret"');
		}

		this.client = new Client({ apiKey: config.apiKey, apiSecret: config.apiSecret });
		this.sandbox = Boolean(config.sandbox);
	}

	/**
	 * Send through Mailjet's Send API.
	 *
	 * @param message - Rendered message.
	 * @returns The message ids Mailjet assigned per recipient (the first as `messageId`), accepted recipients.
	 * @throws Error listing Mailjet's per-message errors when the status is not `success`; the SDK's error when
	 * the request itself fails.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. One message per request; the sandbox flag is a property of the whole body
		const body: SendEmailV3_1.Body = {
			Messages: [await toMailjetMessage(message)],
			...(this.sandbox ? { SandboxMode: true } : {}),
		};

		const result = await this.client.post('send', { version: 'v3.1' }).request<SendEmailV3_1.Response>(body);
		const sent = result.body.Messages[0];

		// 2. A rejected message comes back with status 200 and `Status: 'error'`; that is a failure for `sendMail()`
		if (!sent || sent.Status !== 'success') {
			const errors = (sent?.Errors ?? []).map((error) => error.ErrorMessage ?? JSON.stringify(error));

			throw new Error(`Mailjet: ${errors.join('; ') || `status ${sent?.Status ?? 'unknown'}`}`);
		}

		// 3. Mailjet reports every recipient it took, with a message id each
		const delivered = [...(sent.To ?? []), ...(sent.Cc ?? []), ...(sent.Bcc ?? [])];

		return {
			messageId: delivered[0]?.MessageID !== undefined ? String(delivered[0].MessageID) : undefined,
			accepted: delivered.map((recipient) => recipient.Email),
			rejected: [],
			response: sent.Status,
		};
	}
}

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default MailDriverMailjet;
