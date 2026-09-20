import { useLogger } from '@novastarter/logger';
import type { Logger } from 'pino';
import type { MailDriver, MailMessage, MailResult } from '../../types.js';
import { bareMailAddress, formatMailAddress, toMailAddressList } from '../format-address.js';

/**
 * Options of {@link MailDriverConsole}.
 */
export type MailDriverConsoleConfig = {
	/** Logger to write to; the application logger unless given. */
	logger?: Logger | undefined;
	/** Include the html body in the log line; off by default, it is long. */
	includeHtml?: boolean | undefined;
};

/**
 * Driver that writes every message to the log instead of sending it.
 *
 * The zero-config transport: a fresh clone signs up and resets passwords with the links readable in the terminal.
 * Nothing goes to the console directly — the logger decides where lines end up.
 *
 * @example
 * ```ts
 * useMail().registerLocation('default', {
 * 	driver: 'console',
 * 	options: {},
 * });
 * ```
 */
export class MailDriverConsole implements MailDriver {
	/**
	 * Where the messages are written.
	 *
	 * @internal
	 */
	private readonly logger: Logger;

	/**
	 * Whether the html body joins the log line.
	 *
	 * @internal
	 */
	private readonly includeHtml: boolean;

	/**
	 * Create a driver on the given logger, or on the application's.
	 *
	 * @param config - Logger and verbosity.
	 */
	constructor(config: MailDriverConsoleConfig = {}) {
		// 1. The application logger is resolved here, not at send time, so a swapped logger does not split one
		//    location's output across two destinations
		this.logger = config.logger ?? useLogger();
		this.includeHtml = Boolean(config.includeHtml);
	}

	/**
	 * Log the message.
	 *
	 * @param message - Rendered message.
	 * @returns Every recipient as accepted.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. Recipients are formatted for reading and kept bare for the result, which reports addresses only
		const recipients = toMailAddressList(message.to);
		const to = recipients.map(formatMailAddress);

		// 2. The text body is what a developer reads; the html only when asked, it is a wall of markup
		this.logger.info(
			{
				to,
				...(message.cc ? { cc: message.cc.map(formatMailAddress) } : {}),
				...(message.from ? { from: formatMailAddress(message.from) } : {}),
				subject: message.subject,
				...(message.category ? { category: message.category } : {}),
				...(message.text !== undefined ? { text: message.text } : {}),
				...(this.includeHtml && message.html !== undefined ? { html: message.html } : {}),
			},
			`Mail: ${message.subject}`,
		);

		return {
			accepted: recipients.map(bareMailAddress),
			rejected: [],
		};
	}
}
