import { formatMailAddress, type MailAttachment, type MailMessage, toMailAddressList } from '@novastarter/mail';
import type { CreateEmailOptions } from 'resend';

/**
 * A tag name or value the way Resend accepts it: ASCII letters, digits, underscores and dashes.
 *
 * @param value - Free text.
 * @returns The sanitised text, anything else replaced by `_`.
 */
export const toResendTag = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * An attachment the way Resend takes it.
 *
 * @param attachment - Ours.
 * @returns Resend's: inline content or a path (Resend fetches URLs), with the content id for `cid:` references.
 */
const toResendAttachment = (attachment: MailAttachment): NonNullable<CreateEmailOptions['attachments']>[number] => ({
	// 1. Content and path both pass through as given: Resend reads a path itself, so nothing is read here
	filename: attachment.filename,
	...(attachment.content !== undefined ? { content: attachment.content } : {}),
	...(attachment.path !== undefined ? { path: attachment.path } : {}),
	...(attachment.contentType !== undefined ? { contentType: attachment.contentType } : {}),
	...(attachment.cid !== undefined ? { contentId: attachment.cid } : {}),
});

/**
 * Translate a message into Resend's `emails.send()` payload.
 *
 * The category and the tags become Resend tags (`category=<category>`, `<tag>=1`), which the dashboard filters by.
 *
 * @param message - Ours, with `from` set (`sendMail()` fills it in).
 * @returns Resend's.
 * @throws Error when `from` is missing — Resend requires it.
 */
export const toResendEmail = (message: MailMessage): CreateEmailOptions => {
	// 1. The API refuses a message without a sender; say so before the request goes out
	if (!message.from) {
		throw new Error('Resend needs a "from" address');
	}

	// 2. Tags are sanitised, since Resend refuses anything outside its character set
	const tags = [
		{ name: 'category', value: toResendTag(message.category ?? 'transactional') },
		...(message.tags ?? []).map((tag) => ({ name: toResendTag(tag), value: '1' })),
	];

	// 3. Resend takes `Name <address>` strings and needs one of html / text; both are optional on our side
	const email: CreateEmailOptions = {
		from: formatMailAddress(message.from),
		to: toMailAddressList(message.to).map(formatMailAddress),
		subject: message.subject,
		tags,
		...(message.html !== undefined ? { html: message.html } : {}),
		...(message.text !== undefined ? { text: message.text } : {}),
	} as CreateEmailOptions;

	// 4. Optional fields are only set when present, so the request carries no `undefined` keys
	if (message.cc) email.cc = message.cc.map(formatMailAddress);
	if (message.bcc) email.bcc = message.bcc.map(formatMailAddress);
	if (message.replyTo) email.replyTo = formatMailAddress(message.replyTo);
	if (message.headers) email.headers = message.headers;
	if (message.attachments) email.attachments = message.attachments.map(toResendAttachment);

	return email;
};
