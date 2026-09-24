import { readFile } from 'node:fs/promises';
import { InvalidPayloadError } from '@novastarter/errors';
import type { MailAttachment } from '../types.js';

/**
 * The bytes of an attachment, whichever way it was given.
 *
 * Shared by the vendor drivers whose APIs take the content inline (SendGrid, Postmark, Mailtrap, Mailjet, Mailgun);
 * the nodemailer-based drivers let nodemailer read `path` itself.
 *
 * @param attachment - Attachment of a message.
 * @returns Its content: the given bytes, the given text as UTF-8, or the file at `path`.
 * @throws InvalidPayloadError for an attachment with neither `content` nor `path`.
 * @example
 * ```ts
 * const attachments = await Promise.all(
 * 	(message.attachments ?? []).map(async (attachment) => ({
 * 		filename: attachment.filename,
 * 		content: (await readAttachment(attachment)).toString('base64'),
 * 	})),
 * );
 * ```
 */
export const readAttachment = async (attachment: MailAttachment): Promise<Buffer> => {
	// Text is encoded as UTF-8, the way every provider expects it
	if (attachment.content !== undefined) {
		return Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content, 'utf8');
	}

	// A path is read here, once, so the driver never streams the same file twice
	if (attachment.path !== undefined) {
		return readFile(attachment.path);
	}

	throw new InvalidPayloadError({
		reason: `Attachment "${attachment.filename}" has neither content nor path; give it one of them`,
	});
};
