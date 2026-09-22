import {
	type MailAddress,
	type MailAttachment,
	type MailMessage,
	parseMailAddress,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import type { Address, Attachment, Mail } from 'mailtrap';

/**
 * A `MailAddress` the way Mailtrap takes it.
 *
 * @param address - Ours.
 * @returns `{ email, name? }`.
 */
export const toMailtrapAddress = (address: MailAddress): Address => {
	// 1. The object APIs take name and address apart, so a display-name string is parsed, not flattened to the address
	const parsed = parseMailAddress(address);

	return { email: parsed.address, ...(parsed.name !== undefined ? { name: parsed.name } : {}) };
};

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
