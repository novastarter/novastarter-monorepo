import {
	formatMailAddress,
	type MailAttachment,
	type MailMessage,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import type { MailgunMessageData } from 'mailgun.js/definitions';

/**
 * A file the way Mailgun's `attachment` / `inline` form fields take it.
 */
export type MailgunFile = { filename: string; data: Buffer; contentType?: string };

/**
 * Longest tag name Mailgun accepts; a longer one fails the request.
 *
 * @defaultValue 128 characters.
 */
export const MAILGUN_TAG_LENGTH = 128;

/**
 * Most tags Mailgun accepts on one message; the category takes one of them.
 *
 * @defaultValue 3 tags.
 */
export const MAILGUN_TAG_COUNT = 3;

/**
 * The category and the tags as Mailgun takes them: every label brought into Mailgun's character set and cut to its
 * length limit, the ones left empty dropped, the list capped at its count limit — so a label past a limit trims the
 * analytics instead of failing the send.
 *
 * @param message - Ours.
 * @returns The `o:tag` values, the category first.
 */
export const toMailgunTags = (message: MailMessage): string[] =>
	// 1. Mailgun refuses a message over its tag limits: a tag is ASCII letters, digits, `_` and `-` only, so anything
	//    outside the set becomes `_`; each label is then cut, an empty one drops out and the tail past the count is
	//    left off, the category first
	[message.category ?? 'transactional', ...(message.tags ?? [])]
		.map((tag) => tag.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, MAILGUN_TAG_LENGTH))
		.filter((tag) => tag !== '')
		.slice(0, MAILGUN_TAG_COUNT);

/**
 * An attachment the way Mailgun takes it: the bytes and a filename.
 *
 * An inline image is referenced from the html as `cid:<filename>` on Mailgun, so the content id becomes the
 * filename of the `inline` entry.
 *
 * @param attachment - Ours.
 * @returns Mailgun's file.
 * @throws Error when the attachment has neither content nor a path to read.
 */
export const toMailgunFile = async (attachment: MailAttachment): Promise<MailgunFile> => {
	// 1. Mailgun takes the bytes in the multipart body; a path is read here rather than streamed, like the siblings do
	const data = await readAttachment(attachment);

	// 2. The content id stands in for the filename, which is how Mailgun matches `cid:` references
	return {
		filename: attachment.cid ?? attachment.filename,
		data,
		...(attachment.contentType !== undefined ? { contentType: attachment.contentType } : {}),
	};
};

/**
 * Translate a message into the payload of Mailgun's `messages.create()`.
 *
 * The category and the tags become Mailgun tags (`o:tag`), which the dashboard and the stats group by, cut and
 * capped at Mailgun's limits by {@link toMailgunTags}; the reply-to and the custom headers go as `h:` fields;
 * attachments with a content id go to `inline`, the rest to `attachment`.
 *
 * @param message - Ours, with `from` set (`sendMail()` fills it in).
 * @param testMode - Turn Mailgun's test mode on for this message.
 * @returns Mailgun's.
 * @throws Error when `from` is missing — Mailgun requires it.
 */
export const toMailgunMessage = async (message: MailMessage, testMode = false): Promise<MailgunMessageData> => {
	// 1. The API refuses a message without a sender; say so before the request goes out
	if (!message.from) {
		throw new Error('Mailgun needs a "from" address');
	}

	// 2. Recipients as `Name <address>` strings, the form Mailgun parses
	const data: MailgunMessageData = {
		from: formatMailAddress(message.from),
		to: toMailAddressList(message.to).map(formatMailAddress),
		subject: message.subject,
		'o:tag': toMailgunTags(message),
		...(message.html !== undefined ? { html: message.html } : {}),
		...(message.text !== undefined ? { text: message.text } : {}),
		...(message.cc ? { cc: message.cc.map(formatMailAddress) } : {}),
		...(message.bcc ? { bcc: message.bcc.map(formatMailAddress) } : {}),
		...(message.replyTo ? { 'h:Reply-To': formatMailAddress(message.replyTo) } : {}),
		...(testMode ? { 'o:testmode': true } : {}),
	} as MailgunMessageData;

	// 3. Any custom header is an `h:` field on Mailgun
	for (const [name, value] of Object.entries(message.headers ?? {})) {
		data[`h:${name}`] = value;
	}

	// 4. Inline files (content id) apart from regular attachments
	if (message.attachments?.length) {
		const files = await Promise.all(
			message.attachments.map(async (attachment) => ({
				inline: attachment.cid !== undefined,
				file: await toMailgunFile(attachment),
			})),
		);

		const inline = files.filter((entry) => entry.inline).map((entry) => entry.file);
		const regular = files.filter((entry) => !entry.inline).map((entry) => entry.file);

		if (regular.length) data['attachment'] = regular;
		if (inline.length) data['inline'] = inline;
	}

	return data;
};
