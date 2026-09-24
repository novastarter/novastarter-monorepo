import { InvalidConfigError } from '@novastarter/errors';
import nodemailer, { type Transporter } from 'nodemailer';
import type { MailDriver } from '../../driver.js';
import type { MailMessage, MailResult } from '../../types.js';
import { toMailResult } from '../to-mail-result.js';
import { toNodemailerMessage } from '../to-nodemailer-message.js';

/**
 * Options of {@link MailDriverSmtp}.
 */
export type MailDriverSmtpConfig = {
	host: string;
	/** 587 unless given (465 with `secure`). */
	port?: number | undefined;
	/** TLS from the first byte, as opposed to STARTTLS; on unless given when the port is 465. */
	secure?: boolean | undefined;
	/** Do not upgrade to TLS even when the server offers it. */
	ignoreTls?: boolean | undefined;
	user?: string | undefined;
	password?: string | undefined;
	/** Hostname sent in `HELO`. */
	name?: string | undefined;
	/** Keep connections open between messages. */
	pool?: boolean | undefined;
	/** Node TLS options, passed straight through. */
	tls?: Record<string, unknown> | undefined;
};

/**
 * Driver for any SMTP server through nodemailer.
 *
 * Credentials become `auth` only when given, so an open relay on the local network works without a user, and `tls`
 * passes straight through to Node.
 *
 * @example
 * ```ts
 * useMail().registerLocation('main', {
 * 	driver: 'smtp',
 * 	options: {
 * 		host: 'smtp.example.com',
 * 		port: 587,
 * 		user: env['MAIL_SMTP_USER'],
 * 		password: env['MAIL_SMTP_PASSWORD'],
 * 	},
 * });
 * ```
 */
export class MailDriverSmtp implements MailDriver {
	/**
	 * nodemailer's SMTP transport, holding the connection settings.
	 *
	 * @internal
	 */
	private readonly transporter: Transporter;

	/**
	 * Create a driver for the given server.
	 *
	 * @param config - Connection settings.
	 * @throws InvalidConfigError when no host is configured.
	 */
	constructor(config: MailDriverSmtpConfig) {
		if (!config.host) {
			throw new InvalidConfigError({ reason: 'The smtp mail driver needs a "host"' });
		}

		// Credentials are optional: an authenticated relay needs both, an internal one none
		const auth = config.user || config.password ? { user: config.user ?? '', pass: config.password ?? '' } : undefined;

		// Optional settings are only set when given, so nodemailer applies its own defaults for the rest: `port` and
		// `secure` imply each other there (465 with `secure`, `secure` with 465), which a forced value would break
		this.transporter = nodemailer.createTransport({
			host: config.host,
			...(config.port !== undefined ? { port: config.port } : {}),
			...(config.secure !== undefined ? { secure: config.secure } : {}),
			ignoreTLS: Boolean(config.ignoreTls),
			...(auth ? { auth } : {}),
			...(config.name ? { name: config.name } : {}),
			...(config.pool ? { pool: true } : {}),
			...(config.tls ? { tls: config.tls } : {}),
		});
	}

	/**
	 * Send the message over SMTP.
	 *
	 * @param message - Rendered message.
	 * @returns What the server answered.
	 * @throws nodemailer's error when the server refuses or cannot be reached.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		return toMailResult(await this.transporter.sendMail(toNodemailerMessage(message)));
	}

	/**
	 * Connect and authenticate without sending.
	 *
	 * @throws nodemailer's error when that fails.
	 */
	async verify(): Promise<void> {
		// A handshake and, with credentials, a login: the cheapest proof the server is reachable
		await this.transporter.verify();
	}

	/**
	 * Close the pooled connections; the process is shutting down.
	 *
	 * @returns Once the transport let them go.
	 */
	async close(): Promise<void> {
		// Without this a pooled transport keeps its sockets open and the process from exiting
		this.transporter.close();
	}
}
