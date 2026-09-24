import { InvalidPayloadError } from '@novastarter/errors';
import {
	formatMailAddress,
	type MailAttachment,
	type MailMessage,
	readAttachment,
	toMailAddressList,
} from '@novastarter/mail';
import type { Message, Models } from 'postmark';

/**
 * The streams of a location: one per category.
 */
export type PostmarkStreams = { messageStream?: string | undefined; broadcastStream?: string | undefined };

/**
 * Longest `Metadata` value Postmark accepts; a longer one is refused with error code 300.
 *
 * @defaultValue 80 characters.
 */
export const POSTMARK_METADATA_VALUE_LENGTH = 80;

/**
 * Most `Metadata` fields Postmark accepts on one message; the category takes one of them.
 *
 * @defaultValue 10 fields.
 */
export const POSTMARK_METADATA_FIELDS = 10;

/**
 * An attachment the way Postmark takes it: base64 content, a content type and — inline — a `cid:` content id.
 *
 * @param attachment - Ours.
 * @returns Postmark's.
 * @throws InvalidPayloadError when the attachment has neither content nor a path to read.
 */
export const toPostmarkAttachment = async (attachment: MailAttachment): Promise<Models.Attachment> => {
	// Postmark wants base64 in the JSON body and a content type on every attachment
	const content = await readAttachment(attachment);

	// An inline image is matched to the html by `cid:<id>`; Postmark keeps the prefix in the field
	return {
		Name: attachment.filename,
		Content: content.toString('base64'),
		ContentType: attachment.contentType ?? 'application/octet-stream',
		ContentID: attachment.cid !== undefined ? `cid:${attachment.cid}` : null,
	};
};

/**
 * Pack tags into `Metadata` fields that Postmark will accept.
 *
 * Postmark refuses a metadata value past {@link POSTMARK_METADATA_VALUE_LENGTH} characters, so the comma-joined
 * tags are cut into as many values as they need: `tags`, then `tags2`, `tags3` and so on. A tag longer than one
 * value is cut to the limit, so its prefix still shows in the activity view. A tag left empty by the cut joins
 * nothing and is skipped, so no stray comma lands in a value. The category takes one of the
 * {@link POSTMARK_METADATA_FIELDS}; tags that do not fit into the fields left over are dropped rather than failing
 * the send.
 *
 * @param tags - Tags past the first, which goes to `Tag`.
 * @returns The `tags`, `tags2`, … fields, none for no tags.
 */
export const toPostmarkTagsMetadata = (tags: string[]): Record<string, string> => {
	// A tag left empty by the cut is skipped, so it leaves no stray comma in the value
	const values: string[] = [];

	for (const tag of tags) {
		const cut = tag.slice(0, POSTMARK_METADATA_VALUE_LENGTH);

		if (cut === '') {
			continue;
		}

		const last = values.at(-1);

		if (last !== undefined && last.length + 1 + cut.length <= POSTMARK_METADATA_VALUE_LENGTH) {
			values[values.length - 1] = `${last},${cut}`;
		} else {
			values.push(cut);
		}
	}

	// One field is the category; the first value keeps the plain `tags` name so short lists look as before
	return Object.fromEntries(
		values.slice(0, POSTMARK_METADATA_FIELDS - 1).map((value, index) => [index ? `tags${index + 1}` : 'tags', value]),
	);
};

/**
 * Translate a message into Postmark's `sendEmail()` payload.
 *
 * Postmark takes one tag per message: the first of ours (empty labels dropped); the category and the remaining tags
 * go to `Metadata`, which the activity view and the webhooks carry — split across `tags`, `tags2`, … so no value
 * passes Postmark's length limit (see {@link toPostmarkTagsMetadata}). Recipients are comma-joined strings, as its
 * API wants them.
 *
 * @param message - Ours, with `from` set (`sendMail()` fills it in).
 * @param streams - The stream per category, from the location options.
 * @returns Postmark's.
 * @throws InvalidPayloadError when `from` is missing — Postmark requires it.
 */
export const toPostmarkMessage = async (message: MailMessage, streams: PostmarkStreams = {}): Promise<Message> => {
	// The API refuses a message without a sender; say so before the request goes out
	if (!message.from) {
		throw new InvalidPayloadError({ reason: 'Postmark needs a "from" address' });
	}

	// Empty tags record nothing in Postmark, so they are dropped before the first of the rest becomes `Tag`
	const category = message.category ?? 'transactional';
	const [tag, ...moreTags] = (message.tags ?? []).filter((tag) => tag !== '');
	const stream = category === 'marketing' ? (streams.broadcastStream ?? streams.messageStream) : streams.messageStream;

	// Metadata keeps what the single `Tag` cannot: the category and the tags past the first, within Postmark's limits
	const metadata: Record<string, string> = { category, ...toPostmarkTagsMetadata(moreTags) };

	// Optional fields are only set when present, so the request carries no `undefined` keys
	const email = {
		From: formatMailAddress(message.from),
		To: toMailAddressList(message.to).map(formatMailAddress).join(','),
		Subject: message.subject,
		Metadata: metadata,
		...(message.html !== undefined ? { HtmlBody: message.html } : {}),
		...(message.text !== undefined ? { TextBody: message.text } : {}),
		...(message.cc ? { Cc: message.cc.map(formatMailAddress).join(',') } : {}),
		...(message.bcc ? { Bcc: message.bcc.map(formatMailAddress).join(',') } : {}),
		...(message.replyTo ? { ReplyTo: formatMailAddress(message.replyTo) } : {}),
		...(tag !== undefined ? { Tag: tag } : {}),
		...(stream !== undefined ? { MessageStream: stream } : {}),
		...(message.headers ? { Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
	} as Message;

	if (message.attachments?.length) {
		email.Attachments = await Promise.all(message.attachments.map(toPostmarkAttachment));
	}

	return email;
};
