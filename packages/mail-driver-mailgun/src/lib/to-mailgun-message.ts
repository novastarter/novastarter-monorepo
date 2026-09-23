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
 *
 * The bytes travel as a `Blob` typed with the attachment's content type: with Node's own `FormData` the SDK appends a
 * `Blob` as is, while a `Buffer` it wraps in an untyped one and drops `contentType`, leaving Mailgun to guess the type
 * from the filename.
 */
export type MailgunFile = { filename: string; data: Blob; contentType?: string };

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
 * Characters that end a header line or have no printable form.
 *
 * A header value holding one would, once Mailgun rebuilds the `h:` field into a raw header, break the line and let
 * the remainder forge a header of its own; a tab is deliberately allowed, as it only folds the line.
 */
// eslint-disable-next-line no-control-regex -- matching the control characters is exactly the point of the guard
const HEADER_VALUE_UNSAFE_CHARACTERS = /[\x00-\x08\x0a-\x1f\x7f]/;

/**
 * A header name the way RFC 7230 defines a token: the only characters Mailgun's `h:` field can take in a name for it
 * to name one header.
 */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * A custom header the way Mailgun takes it: an `h:<name>` form field.
 *
 * The name has to be a single RFC 7230 token and the value a single line — Mailgun copies both verbatim into a raw
 * header of the message, so a name with a colon or a value with a line break in it would forge or break a header.
 *
 * @param name - Header name.
 * @param value - Header value.
 * @returns The `h:` field name and value.
 * @throws Error when the name is no token or the value holds CR, LF or another control character.
 */
export const toMailgunHeader = (name: string, value: string): { field: string; value: string } => {
	// 1. A name that is not one token would not name a single header, and a line break or control character in the
	//    value would reach the raw header verbatim — refuse either before the request goes out
	if (!HEADER_NAME_PATTERN.test(name) || HEADER_VALUE_UNSAFE_CHARACTERS.test(value)) {
		throw new Error(`Mailgun: the "${name}" header cannot be sent: the name must be a token and the value one line`);
	}

	return { field: `h:${name}`, value };
};

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
 * filename of the `inline` entry. The bytes go as a `Blob` typed with the content type, so the multipart part carries
 * it even when the content id has no extension to guess one from.
 *
 * @param attachment - Ours.
 * @returns Mailgun's file.
 * @throws Error when the attachment has neither content nor a path to read.
 */
export const toMailgunFile = async (attachment: MailAttachment): Promise<MailgunFile> => {
	// 1. Mailgun takes the bytes in the multipart body; a path is read here rather than streamed, like the siblings do
	const data = await readAttachment(attachment);

	// 2. The content id stands in for the filename, which is how Mailgun matches `cid:` references; the bytes are a
	//    typed `Blob` because the SDK sends a `Buffer` untyped, and a bare content id gives Mailgun no type to guess
	return {
		filename: attachment.cid ?? attachment.filename,
		data: new Blob([data], attachment.contentType !== undefined ? { type: attachment.contentType } : {}),
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
 * @throws Error when `from` is missing — Mailgun requires it; Error when a custom header name is no token or a
 * value holds CR, LF or another control character — either would forge a raw header on Mailgun's side.
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

	// 3. Any custom header is an `h:` field on Mailgun; a name or value that would not survive being rebuilt into a
	//    raw header is refused here, before the request goes out
	for (const [name, value] of Object.entries(message.headers ?? {})) {
		const header = toMailgunHeader(name, value);

		data[header.field] = header.value;
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
