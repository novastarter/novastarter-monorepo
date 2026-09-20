import {
	bareMailAddress,
	type MailAddress,
	type MailAttachment,
	type MailMessage,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import type { SendEmailV3_1 } from 'node-mailjet';

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
