/**
 * A recipient or sender: an address, or a name with an address.
 */
export type MailAddress = string | { name: string; address: string };

/**
 * What kind of mail a message is; the router picks the location chain by it.
 */
export type MailCategory = 'transactional' | 'marketing';

/**
 * A file attached to a message: inline content, or a path the driver reads.
 */
export interface MailAttachment {
	filename: string;
	/** Bytes or text of the file; `path` otherwise. */
	content?: Buffer | string | undefined;
	/** File to read, when the content is not given. */
	path?: string | undefined;
	contentType?: string | undefined;
	/** Content id, for images referenced as `cid:` from the html. */
	cid?: string | undefined;
}

/**
 * A message as the application hands it to a driver: rendered html and text, no templates — the application
 * renders, `@novastarter/mail` sends.
 */
export interface MailMessage {
	to: MailAddress | MailAddress[];
	cc?: MailAddress[] | undefined;
	bcc?: MailAddress[] | undefined;
	/** `sendMail()` fills the sender of the routes in when missing. */
	from?: MailAddress | undefined;
	replyTo?: MailAddress | undefined;
	subject: string;
	html?: string | undefined;
	text?: string | undefined;
	attachments?: MailAttachment[] | undefined;
	headers?: Record<string, string> | undefined;
	/** `transactional` unless given. */
	category?: MailCategory | undefined;
	/**
	 * Labels the provider records (Resend tags, SendGrid categories); nodemailer drivers ignore them.
	 *
	 * Every driver adapts the labels to what its provider accepts — character set, length and count — cutting or
	 * dropping the ones past the limits, so a label can cost the provider's analytics but never fail the send.
	 */
	tags?: string[] | undefined;
}

/**
 * What a driver answers after a send.
 */
export interface MailResult {
	/** Provider's id of the message, when it hands one back. */
	messageId?: string | undefined;
	/** Addresses the provider took. */
	accepted: string[];
	/** Addresses the provider refused. */
	rejected: string[];
	/** Provider's raw response line, for the log. */
	response?: string | undefined;
}
