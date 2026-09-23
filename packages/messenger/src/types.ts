/**
 * How a message's text is marked up: plain, Markdown or HTML. Each driver maps it to its messenger's own flavour —
 * Telegram's `MarkdownV2`, Slack's `mrkdwn`.
 */
export type MessengerFormat = 'text' | 'markdown' | 'html';

/**
 * A file sent with a message.
 */
export interface MessengerAttachment {
	/** What the file is: a `photo` the messenger shows inline, or any other file as a `document`. */
	kind: 'photo' | 'document';
	/** A URL the messenger downloads, an id of a file it already has, or the file itself. */
	source: string | Blob;
	/** The file's name, for a `Blob` without one; a `File` carries its own. */
	filename?: string | undefined;
}

/**
 * A message as every messenger driver takes it.
 *
 * What the messengers share: a recipient, text, attachments. What one of them has on top — an effect, a thread, a
 * keyboard — goes in `raw`, which the driver adds to its request as is.
 */
export interface MessengerMessage {
	/** Who gets it, in the messenger's own terms: a Telegram chat id, a Slack channel id. */
	to: string;
	/** The text; the caption when attachments go with it. */
	text?: string | undefined;
	/** How the text is marked up; the driver's default unless given. */
	format?: MessengerFormat | undefined;
	/** Files to send with the text. */
	attachments?: MessengerAttachment[] | undefined;
	/** Deliver without a sound or a banner, where the messenger can. */
	silent?: boolean | undefined;
	/** The location to send through; `default` unless given or overridden by the call. */
	location?: string | undefined;
	/** What only one messenger understands, added to the driver's request as is. */
	raw?: Record<string, unknown> | undefined;
}

/**
 * What a driver answers a sent message with.
 */
export interface MessengerResult {
	/** The messenger's id of the message, for an edit or a reply later. */
	messageId?: string | undefined;
	/** The messenger's whole answer, for what the common fields leave out. */
	raw?: unknown;
}
