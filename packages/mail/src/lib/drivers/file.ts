import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import type { MailDriver } from '../../driver.js';
import type { MailMessage, MailResult } from '../../types.js';
import { toMailResult } from '../to-mail-result.js';
import { toNodemailerMessage } from '../to-nodemailer-message.js';

/**
 * Options of {@link MailDriverFile}.
 */
export type MailDriverFileConfig = {
	/** Directory the `.eml` files go to, created on first send. */
	dir: string;
};

/**
 * Driver that writes every message as an `.eml` file instead of sending it.
 *
 * For tests and for looking at a rendered message in a mail client: the file is the complete RFC 822 message
 * nodemailer's stream transport builds, attachments included. Files are named `<time>-<message id>.eml`.
 *
 * @example
 * ```ts
 * useMail().registerLocation('default', {
 * 	driver: 'file',
 * 	options: {
 * 		dir: './tmp/mail',
 * 	},
 * });
 * ```
 */
export class MailDriverFile implements MailDriver {
	/**
	 * Absolute directory the files are written to.
	 *
	 * @internal
	 */
	private readonly dir: string;

	/**
	 * nodemailer's stream transport, which builds the raw message without sending it.
	 *
	 * @internal
	 */
	private readonly transporter: Transporter;

	/**
	 * Create a driver writing to the given directory.
	 *
	 * @param config - Target directory.
	 * @throws Error when no directory is configured.
	 */
	constructor(config: MailDriverFileConfig) {
		// 1. A missing directory is a configuration error; report it by the option's name
		if (!config.dir) {
			throw new Error('The file mail driver needs a "dir"');
		}

		this.dir = resolve(config.dir);

		// 2. The stream transport with `buffer` hands back the whole message as one Buffer
		this.transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
	}

	/**
	 * Write the message to a file.
	 *
	 * @param message - Rendered message.
	 * @returns The envelope recipients as accepted.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. nodemailer builds the complete message — headers, MIME parts, attachments — the way a server would get it
		const info = await this.transporter.sendMail(toNodemailerMessage(message));

		// 2. The directory is created on first use rather than in the constructor, so `pnpm build` and the like never
		//    litter the working directory
		await mkdir(this.dir, { recursive: true });

		// 3. Sortable by time, unique by message id; the id's angle brackets and `@` are not file-name friendly
		const id = String(info.messageId ?? Date.now()).replace(/[<>@]/g, '');
		const file = join(this.dir, `${Date.now()}-${id}.eml`);

		await writeFile(file, info.message as Buffer);

		return { ...toMailResult(info), response: file };
	}
}
