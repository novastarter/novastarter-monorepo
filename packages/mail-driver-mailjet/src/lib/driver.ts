import type { MailDriver, MailMessage, MailResult } from '@novastarter/mail';
import { Client, type LibraryResponse, type SendEmailV3_1 } from 'node-mailjet';
import { describeError } from './describe-error.js';
import { toMailjetMessage } from './to-mailjet-message.js';

/**
 * Options accepted by {@link MailDriverMailjet}.
 */
export type MailDriverMailjetConfig = {
	/** Public API key. */
	apiKey: string;
	/** Private API key. */
	apiSecret: string;
	/** Validate without delivering — Mailjet's sandbox mode. */
	sandbox?: boolean | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `mailjet` has its options
 * checked against {@link MailDriverMailjetConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		mailjet: MailDriverMailjetConfig;
	}
}

/**
 * Driver for [Mailjet](https://www.mailjet.com), Send API v3.1.
 *
 * @example
 * ```ts
 * import { useMail } from '@novastarter/mail';
 * import { MailDriverMailjet } from '@novastarter/mail-driver-mailjet';
 * import { env } from './env';
 *
 * const mail = useMail();
 *
 * mail.registerDriver('mailjet', MailDriverMailjet);
 * mail.registerLocation('main', {
 * 	driver: 'mailjet',
 * 	options: {
 * 		apiKey: env.MAIL_MAILJET_API_KEY,
 * 		apiSecret: env.MAIL_MAILJET_API_SECRET,
 * 	},
 * });
 * ```
 */
export class MailDriverMailjet implements MailDriver {
	/**
	 * Mailjet's client, bound to the location's key pair.
	 *
	 * @internal
	 */
	private readonly client: Client;

	/**
	 * Whether every message is sent in sandbox mode.
	 *
	 * @internal
	 */
	private readonly sandbox: boolean;

	/**
	 * Create a driver on a client of its own for the given key pair.
	 *
	 * @param config - API key pair and sandbox switch.
	 * @throws Error without both keys.
	 */
	constructor(config: MailDriverMailjetConfig) {
		// 1. Both keys are needed for a request; a missing one is reported by the options' names
		if (!config.apiKey || !config.apiSecret) {
			throw new Error('The mailjet mail driver needs "apiKey" and "apiSecret"');
		}

		this.client = new Client({ apiKey: config.apiKey, apiSecret: config.apiSecret });
		this.sandbox = Boolean(config.sandbox);
	}

	/**
	 * Send through Mailjet's Send API.
	 *
	 * @param message - Rendered message.
	 * @returns The message ids Mailjet assigned per recipient (the first as `messageId`), accepted recipients.
	 * @throws Error listing Mailjet's per-message errors when the status is not `success`; an error naming Mailjet
	 * with the SDK's error as the cause when the request itself fails.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. One message per request; the sandbox flag is a property of the whole body
		const body: SendEmailV3_1.Body = {
			Messages: [await toMailjetMessage(message)],
			...(this.sandbox ? { SandboxMode: true } : {}),
		};

		let result: LibraryResponse<SendEmailV3_1.Response>;

		try {
			result = await this.client.post('send', { version: 'v3.1' }).request<SendEmailV3_1.Response>(body);
		} catch (error) {
			// 2. A transport failure never reaches Mailjet; named like a refusal, the SDK's error as the cause
			throw describeError(error);
		}

		const sent = result.body.Messages[0];

		// 3. A rejected message comes back with status 200 and `Status: 'error'`; that is a failure for `sendMail()`
		if (!sent || sent.Status !== 'success') {
			const errors = (sent?.Errors ?? []).map((error) => error.ErrorMessage ?? JSON.stringify(error));

			throw new Error(`Mailjet: ${errors.join('; ') || `status ${sent?.Status ?? 'unknown'}`}`);
		}

		// 4. Mailjet reports every recipient it took, with a message id each
		const delivered = [...(sent.To ?? []), ...(sent.Cc ?? []), ...(sent.Bcc ?? [])];

		return {
			messageId: delivered[0]?.MessageID !== undefined ? String(delivered[0].MessageID) : undefined,
			accepted: delivered.map((recipient) => recipient.Email),
			rejected: [],
			response: sent.Status,
		};
	}
}
