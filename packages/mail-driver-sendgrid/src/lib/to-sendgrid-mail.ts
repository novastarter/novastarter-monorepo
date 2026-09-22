import {
	type MailAddress,
	type MailAttachment,
	type MailMessage,
	parseMailAddress,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import type { MailDataRequired } from '@sendgrid/mail';

/**
 * Longest category name SendGrid accepts; a longer one fails the request.
 *
 * @defaultValue 255 characters.
 */
export const SENDGRID_CATEGORY_LENGTH = 255;

/**
 * Most categories SendGrid accepts on one message; the category takes one of them.
 *
 * @defaultValue 10 categories.
 */
export const SENDGRID_CATEGORY_COUNT = 10;

/**
 * The category and the tags as SendGrid takes them: every label cut to its length limit, the ones left empty dropped,
 * the list capped at its count limit — so a label past a limit trims the analytics instead of failing the send.
 *
 * @param message - Ours.
 * @returns The `categories` values, the category first.
 */
export const toSendgridCategories = (message: MailMessage): string[] =>
	// 1. SendGrid refuses a message over its category limits, so each label is cut, an empty one drops out and the
	//    tail past the count is left off, the category first
	[message.category ?? 'transactional', ...(message.tags ?? [])]
		.map((category) => category.slice(0, SENDGRID_CATEGORY_LENGTH))
		.filter((category) => category !== '')
		.slice(0, SENDGRID_CATEGORY_COUNT);

/**
 * A `MailAddress` the way SendGrid takes it.
 *
 * @param address - Ours.
 * @returns `{ email, name? }`.
 */
export const toSendgridAddress = (address: MailAddress): { email: string; name?: string } => {
	// 1. The object APIs take name and address apart, so a display-name string is parsed, not flattened to the address
	const parsed = parseMailAddress(address);

	return { email: parsed.address, ...(parsed.name !== undefined ? { name: parsed.name } : {}) };
};

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
 * The category and the tags become SendGrid categories, cut and capped at SendGrid's limits by
 * {@link toSendgridCategories}.
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
		categories: toSendgridCategories(message),
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
