import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import {
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailResult,
	toNodemailerMessage,
} from '@novastarter/mail';
import nodemailer, { type SentMessageInfo, type Transporter } from 'nodemailer';
import { describeError } from './describe-error.js';
import { toSesClientConfig } from './to-ses-client-config.js';
import { toSesMessageTags } from './to-ses-message-tags.js';

/**
 * Options accepted by {@link MailDriverSes}.
 *
 * Credentials are optional: without them the AWS SDK's default chain (environment, profile, instance role) applies.
 */
export type MailDriverSesConfig = {
	/** AWS region, e.g. `eu-west-1`; the SDK's default chain unless given. */
	region?: string | undefined;
	accessKeyId?: string | undefined;
	secretAccessKey?: string | undefined;
	sessionToken?: string | undefined;
	/** Custom endpoint, for LocalStack and the like. */
	endpoint?: string | undefined;
	/** SES configuration set every message is sent with. */
	configurationSet?: string | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `ses` has its options
 * checked against {@link MailDriverSesConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		ses: MailDriverSesConfig;
	}
}

/**
 * Driver for [Amazon SES](https://aws.amazon.com/ses/), through nodemailer's SES transport on the SESv2 SDK.
 *
 * The category and the tags become SES message tags, which show up in the sending events. SES takes only ASCII
 * letters, digits, `_` and `-` in a tag name or value, at most 256 characters of either, so every tag is sanitised
 * on the way (`welcome flow` becomes `welcome_flow`) and one left with no name is dropped, rather than failing the
 * whole send.
 *
 * @example
 * ```ts
 * import { useMail } from '@novastarter/mail';
 * import { MailDriverSes } from '@novastarter/mail-driver-ses';
 * import { env } from './env';
 *
 * const mail = useMail();
 *
 * mail.registerDriver('ses', MailDriverSes);
 * mail.registerLocation('main', {
 * 	driver: 'ses',
 * 	options: {
 * 		region: 'eu-west-1',
 * 		accessKeyId: env.MAIL_SES_ACCESS_KEY_ID,
 * 		secretAccessKey: env.MAIL_SES_SECRET_ACCESS_KEY,
 * 	},
 * });
 * ```
 */
export class MailDriverSes implements MailDriver {
	/**
	 * nodemailer's SES transport on a client of the location's own.
	 *
	 * @internal
	 */
	private readonly transporter: Transporter;

	/**
	 * The SES client behind the transport, kept to destroy it at shutdown.
	 *
	 * @internal
	 */
	private readonly sesClient: SESv2Client;

	/**
	 * Configuration set every message is sent with, when the location names one.
	 *
	 * @internal
	 */
	private readonly configurationSet: string | undefined;

	/**
	 * Create a driver on an SES client of its own.
	 *
	 * @param config - Region, credentials, endpoint, configuration set.
	 * @throws Error when only one half of the `accessKeyId` / `secretAccessKey` pair is given.
	 */
	constructor(config: MailDriverSesConfig = {}) {
		// 1. A client per location, so two regions or two accounts never share credentials; `toSesClientConfig` is
		//    what refuses half a credential pair
		this.sesClient = new SESv2Client(toSesClientConfig(config));

		this.transporter = nodemailer.createTransport({ SES: { sesClient: this.sesClient, SendEmailCommand } });
		this.configurationSet = config.configurationSet;
	}

	/**
	 * Send through SES.
	 *
	 * @param message - Rendered message.
	 * @returns SES's message id and the envelope recipients as accepted.
	 * @throws An error naming SES with the SDK's or nodemailer's error as the cause when SES refuses.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. Tags and the configuration set ride on the `ses` field nodemailer merges into the SendEmailCommand; the tags
		//    are sanitised first, since SES refuses the whole message over one name outside its character set
		let info: SentMessageInfo;

		try {
			info = await this.transporter.sendMail({
				...toNodemailerMessage(message),
				ses: {
					EmailTags: toSesMessageTags(message),
					...(this.configurationSet ? { ConfigurationSetName: this.configurationSet } : {}),
				},
			} as Parameters<Transporter['sendMail']>[0]);
		} catch (error) {
			// 2. The transport or the SDK throws on a refusal; wrapped so the log names the provider
			throw describeError(error);
		}

		// 3. nodemailer reports the envelope; SES itself answers with the message id only
		return toMailResult(info);
	}

	/**
	 * Release the SDK's HTTP agents; the process is shutting down.
	 *
	 * @returns Once the client is destroyed.
	 */
	async close(): Promise<void> {
		// 1. The SES transport holds no sockets of its own and nodemailer defines no `close()` on it, so there is
		//    nothing to release there; the SDK client's keep-alive agents are what keeps the process up
		this.sesClient.destroy();
	}
}
