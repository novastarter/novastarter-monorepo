import {
	formatMailAddress,
	type MailAttachment,
	type MailMessage,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import type { Message, Models } from 'postmark';

/**
 * The streams of a location: one per category.
 */
export type PostmarkStreams = { messageStream?: string | undefined; broadcastStream?: string | undefined };

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
