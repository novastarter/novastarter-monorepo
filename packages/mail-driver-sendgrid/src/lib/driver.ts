import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import { MailService } from '@sendgrid/mail';
import { toSendgridMail } from './to-sendgrid-mail.js';

/**
 * Options accepted by {@link MailDriverSendgrid}.
 */
export type MailDriverSendgridConfig = {
	/** API key with the `Mail Send` permission (`SG.…`). */
	apiKey: string;
	/** Validate without delivering — SendGrid's sandbox mode. */
	sandbox?: boolean | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `sendgrid` has its options
 * checked against {@link MailDriverSendgridConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		sendgrid: MailDriverSendgridConfig;
	}
}

/**
 * Driver for [SendGrid](https://sendgrid.com).
 *
 * Uses its own `MailService` instance rather than the package's default one, so two SendGrid locations with
 * different keys do not share state.
 *
 * @example
 * ```ts
 * import { useMail } from '@novastarter/mail';
 * import { MailDriverSendgrid } from '@novastarter/mail-driver-sendgrid';
 * import { env } from './env';
 *
 * const mail = useMail();
 *
 * mail.registerDriver('sendgrid', MailDriverSendgrid);
 * mail.registerLocation('main', {
 * 	driver: 'sendgrid',
 * 	options: {
 * 		apiKey: env.MAIL_SENDGRID_API_KEY,
 * 	},
 * });
 * ```
 */
export class MailDriverSendgrid implements MailDriver {
	/**
	 * SendGrid's client, bound to the location's key.
	 *
	 * @internal
	 */
	private readonly client: MailService;

	/**
	 * Whether every message is sent in sandbox mode.
	 *
	 * @internal
	 */
	private readonly sandbox: boolean;

	/**
	 * Create a driver on a client of its own for the given key.
	 *
	 * @param config - API key and sandbox switch.
	 * @throws Error without an API key.
	 */
	constructor(config: MailDriverSendgridConfig) {
		// 1. A missing key is a configuration error; report it by the option's name
		if (!config.apiKey) {
			throw new Error('The sendgrid mail driver needs an "apiKey"');
		}

		// 2. A client per location, so two keys never share the package-level default
		this.client = new MailService();
		this.client.setApiKey(config.apiKey);
		this.sandbox = Boolean(config.sandbox);
	}

	/**
	 * Send through the SendGrid API.
	 *
	 * @param message - Rendered message.
	 * @returns SendGrid's message id from the `x-message-id` header; every recipient as accepted.
	 * @throws SendGrid's error (with `response.body` describing the rejection) when the API refuses.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. The API answers with headers only; the message id lives in one of them
		const [response] = await this.client.send(await toSendgridMail(message, this.sandbox));
		const messageId = response.headers['x-message-id'];

		// 2. SendGrid takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: typeof messageId === 'string' ? messageId : undefined,
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
			response: `${response.statusCode}`,
		};
	}
}
