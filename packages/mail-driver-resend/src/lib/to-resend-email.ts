import {
	formatMailAddress,
	type MailAttachment,
	type MailMessage,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import type { CreateEmailOptions } from 'resend';

/**
 * A tag name or value the way Resend accepts it: ASCII letters, digits, underscores and dashes.
 *
 * @param value - Free text.
 * @returns The sanitised text, anything else replaced by `_`.
 */
export const toResendTag = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * An attachment the way Resend takes it: base64 content, with the content id for `cid:` references.
 *
 * Resend's `content` string is base64 and its `path` is a hosted URL it downloads itself, so neither of ours can be
 * forwarded as given: text content is encoded and a local `path` is read here, like the other API drivers do.
 *
 * @param attachment - Ours.
 * @returns Resend's.
 * @throws Error for an attachment with neither content nor path.
 */
export const toResendAttachment = async (
	attachment: MailAttachment,
): Promise<NonNullable<CreateEmailOptions['attachments']>[number]> => {
	// 1. Resend base64-decodes a string `content`, so text is turned into bytes first; a path is read since Resend
	//    only fetches URLs
	const content = await readAttachment(attachment);

	// 2. Optional fields are only set when present, so the request carries no `undefined` keys
	return {
		filename: attachment.filename,
		content: content.toString('base64'),
		...(attachment.contentType !== undefined ? { contentType: attachment.contentType } : {}),
		...(attachment.cid !== undefined ? { contentId: attachment.cid } : {}),
	};
};

/**
 * Translate a message into Resend's `emails.send()` payload.
 *
 * The category and the tags become Resend tags (`category=<category>`, `<tag>=1`), which the dashboard filters by.
 *
 * @param message - Ours, with `from` set (`sendMail()` fills it in).
 * @returns Resend's.
 * @throws Error when `from` is missing — Resend requires it — or when an attachment has neither content nor path.
 */
export const toResendEmail = async (message: MailMessage): Promise<CreateEmailOptions> => {
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

	// 5. Attachments are read in parallel: every one is encoded in full before the request is built
	if (message.attachments) {
		email.attachments = await Promise.all(message.attachments.map(toResendAttachment));
	}

	return email;
};
