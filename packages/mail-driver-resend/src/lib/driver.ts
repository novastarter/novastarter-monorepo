import {
	bareMailAddress,
	formatMailAddress,
	type MailAttachment,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import { type CreateEmailOptions, Resend } from 'resend';

/**
 * Options accepted by {@link MailDriverResend}.
 */
export type MailDriverResendConfig = {
	/** API key from the Resend dashboard (`re_…`). */
	apiKey: string;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `resend` has its options
 * checked against {@link MailDriverResendConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		resend: MailDriverResendConfig;
	}
}

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

/**
 * Driver for [Resend](https://resend.com).
 *
 * @example
 * ```ts
 * useMail().registerDriver('resend', MailDriverResend);
 * useMail().registerLocation('main', {
 * 	driver: 'resend',
 * 	options: {
 * 		apiKey: env['MAIL_RESEND_API_KEY'],
 * 	},
 * });
 * ```
 */
export class MailDriverResend implements MailDriver {
	/**
	 * Resend's client, bound to the location's key.
	 *
	 * @internal
	 */
	private readonly client: Resend;

	/**
	 * Create a driver on a client of its own for the given key.
	 *
	 * @param config - API key.
	 * @throws Error without an API key.
	 */
	constructor(config: MailDriverResendConfig) {
		// 1. A missing key is a configuration error; report it by the option's name
		if (!config.apiKey) {
			throw new Error('The resend mail driver needs an "apiKey"');
		}

		this.client = new Resend(config.apiKey);
	}

	/**
	 * Send through the Resend API.
	 *
	 * @param message - Rendered message.
	 * @returns Resend's message id; every recipient as accepted, since the API takes all or nothing.
	 * @throws Error carrying Resend's error name and message when the API refuses.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		const { data, error } = await this.client.emails.send(toResendEmail(message));

		// 1. The SDK reports failures as a value; they are turned into the throw the fallback of `sendMail()` expects
		if (error || !data) {
			throw new Error(`Resend: ${error?.name ?? 'unknown_error'}: ${error?.message ?? 'no data returned'}`);
		}

		// 2. Resend takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: data.id,
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
		};
	}
}

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default MailDriverResend;
