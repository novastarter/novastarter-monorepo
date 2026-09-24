import { InvalidPayloadError } from '@novastarter/errors';
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
	// SendGrid refuses a message over its category limits, so the labels are adapted rather than refused
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
	// The object APIs take name and address apart, so a display-name string is parsed, not flattened to the address
	const parsed = parseMailAddress(address);

	return { email: parsed.address, ...(parsed.name !== undefined ? { name: parsed.name } : {}) };
};

/**
 * Addresses mapped the way SendGrid takes them, minus every one already used elsewhere in the message.
 *
 * SendGrid refuses the whole send with a 400 when one address repeats across `to`, `cc` and `bcc` of a
 * personalization, while SMTP delivers such a message fine. Addresses compare case-insensitively on the bare address,
 * the display name ignored, and the first occurrence wins.
 *
 * @param addresses - Ours, in order.
 * @param seen - Lower-cased addresses already taken by an earlier list; the ones kept here are added to it.
 * @returns SendGrid's, without repeats.
 * @internal
 */
const toUniqueSendgridAddresses = (addresses: MailAddress[], seen: Set<string>): { email: string; name?: string }[] =>
	// The set is shared, so a later list drops an address seen in an earlier one
	addresses.map(toSendgridAddress).filter((address) => {
		const key = address.email.toLowerCase();

		if (seen.has(key)) {
			return false;
		}

		seen.add(key);

		return true;
	});

/**
 * An attachment the way SendGrid takes it: base64 content, inline when it has a content id.
 *
 * @param attachment - Ours.
 * @returns SendGrid's.
 * @throws InvalidPayloadError for an attachment with neither content nor path.
 */
export const toSendgridAttachment = async (
	attachment: MailAttachment,
): Promise<NonNullable<MailDataRequired['attachments']>[number]> => {
	// SendGrid wants the bytes base64-encoded in the request; a path is read here since the API cannot fetch it
	const content = await readAttachment(attachment);

	// A content id makes the attachment inline, for `cid:` references from the html
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
 * {@link toSendgridCategories}. An address repeated across `to`, `cc` and `bcc` is sent once, in the first list it
 * appears in, since SendGrid refuses the whole message otherwise.
 *
 * @param message - Ours, with `from` set (`sendMail()` fills it in).
 * @param sandbox - Turn SendGrid's sandbox mode on.
 * @returns SendGrid's.
 * @throws InvalidPayloadError when `from` is missing — SendGrid requires it.
 */
export const toSendgridMail = async (message: MailMessage, sandbox = false): Promise<MailDataRequired> => {
	// The API refuses a message without a sender; say so before the request goes out
	if (!message.from) {
		throw new InvalidPayloadError({ reason: 'SendGrid needs a "from" address' });
	}

	// SendGrid refuses a repeated recipient, so `to`, then `cc`, then `bcc` keep only addresses not seen before
	const seen = new Set<string>();
	const to = toUniqueSendgridAddresses(toMailAddressList(message.to), seen);
	const cc = toUniqueSendgridAddresses(message.cc ?? [], seen);
	const bcc = toUniqueSendgridAddresses(message.bcc ?? [], seen);

	// Optional fields are only set when present, so the request carries no `undefined` keys or empty lists
	const mail = {
		to,
		from: toSendgridAddress(message.from),
		subject: message.subject,
		categories: toSendgridCategories(message),
		...(message.html !== undefined ? { html: message.html } : {}),
		...(message.text !== undefined ? { text: message.text } : {}),
		...(cc.length > 0 ? { cc } : {}),
		...(bcc.length > 0 ? { bcc } : {}),
		...(message.replyTo ? { replyTo: toSendgridAddress(message.replyTo) } : {}),
		...(message.headers ? { headers: message.headers } : {}),
		...(sandbox ? { mailSettings: { sandboxMode: { enable: true } } } : {}),
	} as MailDataRequired;

	if (message.attachments) {
		mail.attachments = await Promise.all(message.attachments.map(toSendgridAttachment));
	}

	return mail;
};
