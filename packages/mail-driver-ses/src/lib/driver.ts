import { SendEmailCommand, SESv2Client, type SESv2ClientConfig } from '@aws-sdk/client-sesv2';
import {
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailResult,
	toNodemailerMessage,
} from '@novastarter/mail';
import nodemailer, { type Transporter } from 'nodemailer';

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
 * Build the SESv2 client options from the location options.
 *
 * @param config - Location options.
 * @returns What `SESv2Client` takes; credentials only when both keys are given.
 */
export const toSesClientConfig = (config: MailDriverSesConfig): SESv2ClientConfig => ({
	// 1. Region and endpoint are only set when given, so the SDK's default chain covers the rest
	...(config.region ? { region: config.region } : {}),
	...(config.endpoint ? { endpoint: config.endpoint } : {}),
	// 2. Half a key pair is no credential: the SDK would fail every request with it, the chain may still succeed
	...(config.accessKeyId && config.secretAccessKey
		? {
				credentials: {
					accessKeyId: config.accessKeyId,
					secretAccessKey: config.secretAccessKey,
					...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
				},
			}
		: {}),
});

/**
 * Driver for [Amazon SES](https://aws.amazon.com/ses/), through nodemailer's SES transport on the SESv2 SDK.
 *
 * The category and the tags become SES message tags, which show up in the sending events.
 *
 * @example
 * ```ts
 * useMail().registerDriver('ses', MailDriverSes);
 * useMail().registerLocation('main', {
 * 	driver: 'ses',
 * 	options: {
 * 		region: 'eu-west-1',
 * 		accessKeyId: env['MAIL_SES_ACCESS_KEY_ID'],
 * 		secretAccessKey: env['MAIL_SES_SECRET_ACCESS_KEY'],
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
	 * Configuration set every message is sent with, when the location names one.
	 *
	 * @internal
	 */
	private readonly configurationSet: string | undefined;

	/**
	 * Create a driver on an SES client of its own.
	 *
	 * @param config - Region, credentials, endpoint, configuration set.
	 */
	constructor(config: MailDriverSesConfig = {}) {
		// 1. A client per location, so two regions or two accounts never share credentials
		const sesClient = new SESv2Client(toSesClientConfig(config));

		this.transporter = nodemailer.createTransport({ SES: { sesClient, SendEmailCommand } });
		this.configurationSet = config.configurationSet;
	}

	/**
	 * Send through SES.
	 *
	 * @param message - Rendered message.
	 * @returns SES's message id and the envelope recipients as accepted.
	 * @throws The SDK's error when SES refuses.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. Tags and the configuration set ride on the `ses` field nodemailer merges into the SendEmailCommand
		const tags = [
			{ Name: 'category', Value: message.category ?? 'transactional' },
			...(message.tags ?? []).map((tag) => ({ Name: tag, Value: '1' })),
		];

		const info = await this.transporter.sendMail({
			...toNodemailerMessage(message),
			ses: {
				EmailTags: tags,
				...(this.configurationSet ? { ConfigurationSetName: this.configurationSet } : {}),
			},
		} as Parameters<Transporter['sendMail']>[0]);

		// 2. nodemailer reports the envelope; SES itself answers with the message id only
		return toMailResult(info);
	}
}

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default MailDriverSes;
