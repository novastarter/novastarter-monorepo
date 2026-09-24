import type { SendMailOptions } from 'nodemailer';
import type { MailAddress, MailMessage } from '../types.js';

/**
 * A `MailAddress` the way nodemailer takes it.
 *
 * @param address - Ours.
 * @returns A string or `{ name, address }`, which nodemailer formats and encodes itself.
 * @example
 * ```ts
 * toNodemailerAddress({ name: 'Ada', address: 'ada@example.com' });
 * // => { name: 'Ada', address: 'ada@example.com' }
 * ```
 */
export const toNodemailerAddress = (address: MailAddress): string | { name: string; address: string } =>
	// Both shapes are nodemailer's own, so nothing is formatted here and its quoting and encoding apply
	address;

/**
 * Translate a message into nodemailer's `SendMailOptions`.
 *
 * Shared by every nodemailer-based driver (smtp, sendmail, file, ses). `category` and `tags` have no place in a raw
 * message and are left to the vendor drivers; nodemailer reads files for attachments given by `path`.
 *
 * @param message - Ours.
 * @returns nodemailer's.
 * @example
 * ```ts
 * async send(message: MailMessage): Promise<MailResult> {
 * 	return toMailResult(await this.transporter.sendMail(toNodemailerMessage(message)));
 * }
 * ```
 */
export const toNodemailerMessage = (message: MailMessage): SendMailOptions => {
	// `to` keeps its shape: nodemailer takes a single address or a list
	const options: SendMailOptions = {
		to: Array.isArray(message.to) ? message.to.map(toNodemailerAddress) : toNodemailerAddress(message.to),
		subject: message.subject,
	};

	// Optional fields are only set when present, so nodemailer applies its own defaults for the rest
	if (message.cc) options.cc = message.cc.map(toNodemailerAddress);
	if (message.bcc) options.bcc = message.bcc.map(toNodemailerAddress);
	if (message.from) options.from = toNodemailerAddress(message.from);
	if (message.replyTo) options.replyTo = toNodemailerAddress(message.replyTo);
	if (message.html !== undefined) options.html = message.html;
	if (message.text !== undefined) options.text = message.text;
	if (message.headers) options.headers = message.headers;

	// Attachments keep `path` as given: nodemailer reads the file itself when it builds the message
	if (message.attachments) {
		options.attachments = message.attachments.map((attachment) => ({
			filename: attachment.filename,
			...(attachment.content !== undefined ? { content: attachment.content } : {}),
			...(attachment.path !== undefined ? { path: attachment.path } : {}),
			...(attachment.contentType !== undefined ? { contentType: attachment.contentType } : {}),
			...(attachment.cid !== undefined ? { cid: attachment.cid } : {}),
		}));
	}

	return options;
};
