import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import { Resend } from 'resend';
import { toResendEmail } from './to-resend-email.js';

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
 * Driver for [Resend](https://resend.com).
 *
 * @example
 * ```ts
 * import { useMail } from '@novastarter/mail';
 * import { MailDriverResend } from '@novastarter/mail-driver-resend';
 * import { env } from './env';
 *
 * const mail = useMail();
 *
 * mail.registerDriver('resend', MailDriverResend);
 * mail.registerLocation('main', {
 * 	driver: 'resend',
 * 	options: {
 * 		apiKey: env.MAIL_RESEND_API_KEY,
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
