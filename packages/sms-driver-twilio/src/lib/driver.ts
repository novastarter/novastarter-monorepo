import type { SmsDriver, SmsMessage, SmsResult } from '@novastarter/sms';
import twilio from 'twilio';
import { describeError } from './describe-error.js';
import { toTwilioMessage } from './to-twilio-message.js';

/**
 * The client `twilio()` builds; kept as a type of its own, since the SDK exports it only through its namespace.
 */
type TwilioClient = ReturnType<typeof twilio>;

/**
 * Options accepted by {@link SmsDriverTwilio}.
 */
export type SmsDriverTwilioConfig = {
	/** Account SID from the Twilio console (`AC…`). */
	accountSid: string;
	/** Auth token of the account; the alternative to an API key pair. */
	authToken?: string | undefined;
	/** API key SID (`SK…`), used with `apiSecret` instead of the auth token. */
	apiKey?: string | undefined;
	/** Secret of the API key. */
	apiSecret?: string | undefined;
	/** Messaging service (`MG…`) that picks the sender for a message without a `from` of its own. */
	messagingServiceSid?: string | undefined;
	/** URL Twilio posts delivery status updates to. */
	statusCallback?: string | undefined;
	/** How long a request may take, in milliseconds; the SDK's 30 s unless given. */
	timeout?: number | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/sms`, so a location naming `twilio` has its options
 * checked against {@link SmsDriverTwilioConfig}.
 */
declare module '@novastarter/sms' {
	interface SmsDrivers {
		twilio: SmsDriverTwilioConfig;
	}
}

/**
 * Driver for [Twilio](https://www.twilio.com) Programmable Messaging.
 *
 * An API key pair is preferred over the account's auth token, since a key can be revoked on its own; either one
 * authenticates the same account.
 *
 * @example
 * ```ts
 * import { useSms } from '@novastarter/sms';
 * import { SmsDriverTwilio } from '@novastarter/sms-driver-twilio';
 * import { env } from './env';
 *
 * const sms = useSms();
 *
 * sms.registerDriver('twilio', SmsDriverTwilio);
 * sms.registerLocation('main', {
 * 	driver: 'twilio',
 * 	options: {
 * 		accountSid: env.SMS_TWILIO_ACCOUNT_SID,
 * 		authToken: env.SMS_TWILIO_AUTH_TOKEN,
 * 	},
 * });
 * ```
 */
export class SmsDriverTwilio implements SmsDriver {
	/**
	 * Twilio's client, bound to the location's credentials.
	 *
	 * @internal
	 */
	private readonly client: TwilioClient;

	/**
	 * What every message of this location carries on top of its own fields.
	 *
	 * @internal
	 */
	private readonly defaults: Pick<SmsDriverTwilioConfig, 'messagingServiceSid' | 'statusCallback'>;

	/**
	 * Create a driver on a client of its own for the given account.
	 *
	 * @param config - Credentials and the location's defaults.
	 * @throws Error without an account SID, or without either an auth token or a complete API key pair.
	 */
	constructor(config: SmsDriverTwilioConfig) {
		// 1. A missing account is a configuration error; report it by the option's name
		if (!config.accountSid) {
			throw new Error('The twilio sms driver needs an "accountSid"');
		}

		// 2. Two ways to authenticate, and half a key pair is neither; naming both spares the reader the console
		const hasApiKey = Boolean(config.apiKey && config.apiSecret);

		if (!config.authToken && !hasApiKey) {
			throw new Error('The twilio sms driver needs an "authToken", or an "apiKey" with its "apiSecret"');
		}

		// 3. An API key signs for the account it is scoped to, so the account SID travels in the options; the auth
		//    token is the account's own and goes in as the user name
		const options = config.timeout !== undefined ? { timeout: config.timeout } : {};

		this.client = hasApiKey
			? twilio(config.apiKey, config.apiSecret, { ...options, accountSid: config.accountSid })
			: twilio(config.accountSid, config.authToken, options);

		this.defaults = {
			...(config.messagingServiceSid !== undefined ? { messagingServiceSid: config.messagingServiceSid } : {}),
			...(config.statusCallback !== undefined ? { statusCallback: config.statusCallback } : {}),
		};
	}

	/**
	 * Send through the Twilio API.
	 *
	 * @param message - Message with its recipient in E.164.
	 * @returns Twilio's message SID, the status it queued the message under and the number of segments it was split
	 * into.
	 * @throws Error naming Twilio's status and error code when the API refuses, or when it accepts a message it
	 * already knows it cannot deliver; the SDK's error as the cause.
	 */
	async send(message: SmsMessage): Promise<SmsResult> {
		// 1. The SDK rejects with a `RestException` for anything the API refused; `describeError` keeps Twilio's own
		//    error code, which is what an application matches on
		const created = await this.client.messages
			.create(toTwilioMessage(message, this.defaults))
			.catch((error: unknown) => {
				throw describeError(error);
			});

		// 2. A message may come back accepted and already failed — an unusable number, a recipient who unsubscribed —
		//    so the error code of the answer is checked too, and reported as a failure rather than as a send
		if (created.errorCode) {
			throw new Error(`Twilio: ${created.errorCode}: ${created.errorMessage || created.status}`, {
				cause: created,
			});
		}

		// 3. Segments are what the message is billed by; the SDK reports the count as a string
		const segments = Number(created.numSegments);

		return {
			messageId: created.sid,
			status: created.status,
			...(Number.isFinite(segments) ? { segments } : {}),
		};
	}

	/**
	 * Check the credentials without sending.
	 *
	 * @throws Error naming Twilio's status when the account cannot be read.
	 */
	async verify(): Promise<void> {
		// 1. The account balance is the cheapest authenticated read there is: no resource is created, nothing is billed
		await this.client.balance.fetch().catch((error: unknown) => {
			throw describeError(error);
		});
	}
}
