import type { MessengerAttachment, MessengerFormat, MessengerMessage } from '@novastarter/messenger';

/**
 * A Bot API call a message turns into.
 */
export interface TelegramRequest {
	/** The method: `sendMessage`, `sendPhoto`, `sendDocument`, `sendMediaGroup`. */
	method: string;
	/** Its parameters; a `Blob` among them makes the call multipart. */
	params: Record<string, unknown>;
}

/**
 * The `parse_mode` of a format: `MarkdownV2` for Markdown, `HTML` for HTML, none for plain text.
 *
 * @param format - The format.
 * @returns The parse mode, or `undefined` for plain text.
 */
export const toParseMode = (format: MessengerFormat | undefined): string | undefined => {
	// `MarkdownV2`, not the legacy `Markdown`: the old one cannot escape everything and Telegram keeps it for
	// compatibility only
	if (format === 'markdown') return 'MarkdownV2';
	if (format === 'html') return 'HTML';

	return undefined;
};

/**
 * The source of an attachment as the Bot API takes it: a URL or a file id as is, a `Blob` as a named `File`.
 *
 * @param attachment - The attachment.
 * @returns A string, or a `File` carrying the name Telegram shows.
 * @internal
 */
const toSource = (attachment: MessengerAttachment): string | Blob => {
	// A `File` keeps its own name; a bare `Blob` gets the attachment's, or a neutral one, since Telegram shows it
	if (typeof attachment.source === 'string' || attachment.source instanceof File) {
		return attachment.source;
	}

	return new File([attachment.source], attachment.filename ?? 'file', { type: attachment.source.type });
};

/**
 * Turn a message into the Bot API call that sends it.
 *
 * - no attachment → `sendMessage`;
 * - one photo → `sendPhoto`, one document → `sendDocument`, the text as the caption;
 * - several → `sendMediaGroup`, the text as the first one's caption, files as `attach://fileN` parts.
 *
 * `raw` is added last, so it can set or override any parameter. Nothing is checked against Telegram's limits: the API
 * refuses what it cannot take, in its own words.
 *
 * @param message - The message.
 * @param defaultFormat - The format when the message names none.
 * @returns The method and its parameters; `undefined` values are left out.
 */
export const toTelegramRequest = (message: MessengerMessage, defaultFormat?: MessengerFormat): TelegramRequest => {
	const attachments = message.attachments ?? [];
	const parseMode = toParseMode(message.format ?? defaultFormat);

	const base: Record<string, unknown> = {
		chat_id: message.to,
		...(message.silent ? { disable_notification: true } : {}),
	};

	const text = message.text && message.text.length > 0 ? message.text : undefined;

	const markup = (field: string): Record<string, unknown> =>
		text === undefined ? {} : { [field]: text, ...(parseMode ? { parse_mode: parseMode } : {}) };

	if (attachments.length === 0) {
		return { method: 'sendMessage', params: { ...base, ...markup('text'), ...message.raw } };
	}

	if (attachments.length === 1) {
		const [attachment] = attachments as [MessengerAttachment];
		const method = attachment.kind === 'photo' ? 'sendPhoto' : 'sendDocument';

		return {
			method,
			params: { ...base, [attachment.kind]: toSource(attachment), ...markup('caption'), ...message.raw },
		};
	}

	// A file is referenced from the album's list by the name of its multipart part
	const files: Record<string, unknown> = {};

	const media = attachments.map((attachment, index) => {
		const source = toSource(attachment);

		if (typeof source !== 'string') {
			files[`file${index}`] = source;
		}

		return {
			type: attachment.kind,
			media: typeof source === 'string' ? source : `attach://file${index}`,
			...(index === 0 ? markup('caption') : {}),
		};
	});

	return { method: 'sendMediaGroup', params: { ...base, media, ...files, ...message.raw } };
};
