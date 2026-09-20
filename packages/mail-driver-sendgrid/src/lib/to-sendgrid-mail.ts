import {
	bareMailAddress,
	type MailAddress,
	type MailAttachment,
	type MailMessage,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import type { MailDataRequired } from '@sendgrid/mail';

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
