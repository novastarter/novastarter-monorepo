import { InvalidPayloadError } from '@novastarter/errors';
import {
	type MailAddress,
	type MailAttachment,
	type MailMessage,
	parseMailAddress,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import type { SendEmailV3_1 } from 'node-mailjet';

/**
 * An attachment the way Mailjet takes it.
 */
export type MailjetAttachment = { ContentType: string; Filename: string; Base64Content: string; ContentID?: string };

/**
 * Longest `CustomID` Mailjet accepts; a longer one fails the whole request, so the joined tags are cut to fit.
 *
 * @defaultValue 255 characters.
 */
export const MAILJET_CUSTOM_ID_MAX_LENGTH = 255;

/**
 * A `MailAddress` the way Mailjet takes it.
 *
 * @param address - Ours.
 * @returns `{ Email, Name? }`.
 */
export const toMailjetAddress = (address: MailAddress): { Email: string; Name?: string } => {
	// The object APIs take name and address apart, so a display-name string is parsed, not flattened to the address
	const parsed = parseMailAddress(address);

	return { Email: parsed.address, ...(parsed.name !== undefined ? { Name: parsed.name } : {}) };
};

/**
 * An attachment the way Mailjet takes it: base64 content and a content type.
 *
 * @param attachment - Ours.
 * @returns Mailjet's, with `ContentID` when inline.
 * @throws InvalidPayloadError when the attachment has neither content nor a path to read.
 */
export const toMailjetAttachment = async (attachment: MailAttachment): Promise<MailjetAttachment> => {
	// Mailjet wants base64 in the request and a content type on every attachment
	const content = await readAttachment(attachment);

	// The content id marks the attachment as inline; `toMailjetMessage` sorts on it
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
 * The category becomes `CustomCampaign`, the tags `CustomID` (joined, cut at {@link MAILJET_CUSTOM_ID_MAX_LENGTH}),
 * which Mailjet's statistics group by.
 *
 * @param message - Ours, with `from` set (`sendMail()` fills it in).
 * @returns Mailjet's.
 * @throws InvalidPayloadError when `from` is missing — Mailjet requires it.
 */
export const toMailjetMessage = async (message: MailMessage): Promise<SendEmailV3_1.Message> => {
	// The API refuses a message without a sender, so it is refused before the request goes out
	if (!message.from) {
		throw new InvalidPayloadError({ reason: 'Mailjet needs a "from" address' });
	}

	// Mailjet keeps inline attachments (those with a content id) in a list of their own
	const attachments = await Promise.all((message.attachments ?? []).map(toMailjetAttachment));
	const inline = attachments.filter((attachment) => attachment.ContentID !== undefined);
	const regular = attachments.filter((attachment) => attachment.ContentID === undefined);

	// `CustomID` is cut to the limit: a longer value would fail the whole request, and a tag must never be the reason a
	// send fails
	const customId = (message.tags ?? []).join(',').slice(0, MAILJET_CUSTOM_ID_MAX_LENGTH);

	// Optional fields are only set when present, so the request carries no `undefined` keys
	return {
		From: toMailjetAddress(message.from),
		To: toMailAddressList(message.to).map(toMailjetAddress),
		Subject: message.subject,
		CustomCampaign: message.category ?? 'transactional',
		...(customId ? { CustomID: customId } : {}),
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
