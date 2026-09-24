import nodemailer, { type Transporter } from 'nodemailer';
import type { MailDriver } from '../../driver.js';
import type { MailMessage, MailResult } from '../../types.js';
import { toMailResult } from '../to-mail-result.js';
import { toNodemailerMessage } from '../to-nodemailer-message.js';

/**
 * Options of {@link MailDriverSendmail}.
 */
export type MailDriverSendmailConfig = {
	/** The binary; `/usr/sbin/sendmail` unless given. */
	path?: string | undefined;
	/** Line endings piped to it: `unix` unless given, `windows` for Exchange-style setups. */
	newLine?: string | undefined;
};

/**
 * Driver that pipes messages to the local `sendmail` binary.
 *
 * For hosts with a configured MTA; nothing to verify, the binary either runs or not.
 *
 * @example
 * ```ts
 * useMail().registerLocation('main', {
 * 	driver: 'sendmail',
 * 	options: {
 * 		path: '/usr/sbin/sendmail',
 * 	},
 * });
 * ```
 */
export class MailDriverSendmail implements MailDriver {
	/**
	 * nodemailer's sendmail transport, spawning the binary per message.
	 *
	 * @internal
	 */
	private readonly transporter: Transporter;

	/**
	 * Create a driver on the given binary, or on the system's.
	 *
	 * @param config - Binary and line endings.
	 */
	constructor(config: MailDriverSendmailConfig = {}) {
		// The defaults are the ones of a stock Unix host, so a bare `sendmail` location works without options
		this.transporter = nodemailer.createTransport({
			sendmail: true,
			newline: config.newLine ?? 'unix',
			path: config.path ?? '/usr/sbin/sendmail',
		});
	}

	/**
	 * Pipe the message to sendmail.
	 *
	 * @param message - Rendered message.
	 * @returns The envelope recipients as accepted; sendmail reports nothing more.
	 * @throws nodemailer's error when the binary fails.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// The binary answers nothing usable, so the result is built from the envelope
		return toMailResult(await this.transporter.sendMail(toNodemailerMessage(message)));
	}
}
