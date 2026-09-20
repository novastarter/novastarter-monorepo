import {
	bareMailAddress,
	formatMailAddress,
	type MailAttachment,
	type MailDriver,
	type MailMessage,
	type MailResult,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import { type Message, type Models, ServerClient } from 'postmark';

/**
 * Options accepted by {@link MailDriverPostmark}.
 */
export type MailDriverPostmarkConfig = {
	/** Server API token from the Postmark server's "API Tokens" tab. */
	serverToken: string;
	/** Message stream transactional mail goes to; Postmark's default transactional stream (`outbound`) unless given. */
	messageStream?: string | undefined;
	/** Message stream `marketing` mail goes to — a broadcast stream; `messageStream` unless given. */
	broadcastStream?: string | undefined;
	/** Request timeout in seconds; the SDK's default unless given. */
	timeout?: number | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `postmark` has its options
 * checked against {@link MailDriverPostmarkConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		postmark: MailDriverPostmarkConfig;
	}
}

/**
 * The streams of a location: one per category.
 */
type PostmarkStreams = { messageStream?: string | undefined; broadcastStream?: string | undefined };

/**
 * An attachment the way Postmark takes it: base64 content, a content type and — inline — a `cid:` content id.
 *
 * @param attachment - Ours.
 * @returns Postmark's.
 * @throws Error when the attachment has neither content nor a path to read.
 */
export const toPostmarkAttachment = async (attachment: MailAttachment): Promise<Models.Attachment> => {
	// 1. Postmark wants base64 in the JSON body and a content type on every attachment
	const content = await readAttachment(attachment);

	// 2. An inline image is matched to the html by `cid:<id>` — Postmark keeps the prefix in the field
	return {
		Name: attachment.filename,
		Content: content.toString('base64'),
		ContentType: attachment.contentType ?? 'application/octet-stream',
		ContentID: attachment.cid !== undefined ? `cid:${attachment.cid}` : null,
	};
};

/**
 * Translate a message into Postmark's `sendEmail()` payload.
 *
 * Postmark takes one tag per message: the first of ours; the category and the remaining tags go to `Metadata`, which
 * the activity view and the webhooks carry. Recipients are comma-joined strings, as its API wants them.
 *
 * @param message - Ours, with `from` set (`sendMail()` fills it in).
 * @param streams - The stream per category, from the location options.
 * @returns Postmark's.
 * @throws Error when `from` is missing — Postmark requires it.
 */
export const toPostmarkMessage = async (message: MailMessage, streams: PostmarkStreams = {}): Promise<Message> => {
	// 1. The API refuses a message without a sender; say so before the request goes out
	if (!message.from) {
		throw new Error('Postmark needs a "from" address');
	}

	// 2. Marketing mail goes to the broadcast stream when there is one; everything else to the message stream
	const category = message.category ?? 'transactional';
	const [tag, ...moreTags] = message.tags ?? [];
	const stream = category === 'marketing' ? (streams.broadcastStream ?? streams.messageStream) : streams.messageStream;

	// 3. Metadata keeps what the single `Tag` cannot: the category and the tags past the first
	const metadata: Record<string, string> = { category };

	if (moreTags.length) metadata['tags'] = moreTags.join(',');

	// 4. Optional fields are only set when present, so the request carries no `undefined` keys
	const email = {
		From: formatMailAddress(message.from),
		To: toMailAddressList(message.to).map(formatMailAddress).join(','),
		Subject: message.subject,
		Metadata: metadata,
		...(message.html !== undefined ? { HtmlBody: message.html } : {}),
		...(message.text !== undefined ? { TextBody: message.text } : {}),
		...(message.cc ? { Cc: message.cc.map(formatMailAddress).join(',') } : {}),
		...(message.bcc ? { Bcc: message.bcc.map(formatMailAddress).join(',') } : {}),
		...(message.replyTo ? { ReplyTo: formatMailAddress(message.replyTo) } : {}),
		...(tag !== undefined ? { Tag: tag } : {}),
		...(stream !== undefined ? { MessageStream: stream } : {}),
		...(message.headers ? { Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
	} as Message;

	// 5. Attachments are read in parallel: every one is encoded in full before the request is built
	if (message.attachments?.length) {
		email.Attachments = await Promise.all(message.attachments.map(toPostmarkAttachment));
	}

	return email;
};

/**
 * Driver for [Postmark](https://postmarkapp.com), through the official `postmark` SDK.
 *
 * @example
 * ```ts
 * useMail().registerDriver('postmark', MailDriverPostmark);
 * useMail().registerLocation('main', {
 * 	driver: 'postmark',
 * 	options: {
 * 		serverToken: env['MAIL_POSTMARK_SERVER_TOKEN'],
 * 		broadcastStream: 'newsletter',
 * 	},
 * });
 * ```
 */
export class MailDriverPostmark implements MailDriver {
	/**
	 * Postmark's server client, bound to the location's token.
	 *
	 * @internal
	 */
	private readonly client: ServerClient;

	/**
	 * The stream per category, as the location was registered with.
	 *
	 * @internal
	 */
	private readonly streams: PostmarkStreams;

	/**
	 * Create a driver on a client of its own for the given token.
	 *
	 * @param config - Server token, streams and timeout.
	 * @throws Error without a server token.
	 */
	constructor(config: MailDriverPostmarkConfig) {
		// 1. A missing token is a configuration error; report it by the option's name
		if (!config.serverToken) {
			throw new Error('The postmark mail driver needs a "serverToken"');
		}

		// 2. The SDK's `Configuration` is `(useHttps, requestHost, timeout)`; only the timeout is ours to set
		this.client = new ServerClient(
			config.serverToken,
			config.timeout !== undefined ? { timeout: config.timeout } : undefined,
		);

		this.streams = { messageStream: config.messageStream, broadcastStream: config.broadcastStream };
	}

	/**
	 * Send through the Postmark Email API.
	 *
	 * @param message - Rendered message.
	 * @returns Postmark's message id; every recipient as accepted — a refused recipient fails the whole request.
	 * @throws The SDK's error (`PostmarkError` with `code` and `statusCode`; `InactiveRecipientsError` names the
	 * suppressed recipients) when the API refuses.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		const response = await this.client.sendEmail(await toPostmarkMessage(message, this.streams));

		// 1. Postmark takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: response.MessageID,
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
			response: response.Message,
		};
	}

	/**
	 * Check the token without sending: the server it belongs to has to answer.
	 *
	 * @throws The SDK's error (`InvalidAPIKeyError` for a bad token) when Postmark refuses.
	 */
	async verify(): Promise<void> {
		// 1. The cheapest authenticated call: the server's own record
		await this.client.getServer();
	}
}

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default MailDriverPostmark;
