import type { SmsDriver, SmsMessage, SmsResult } from '@novastarter/sms';
import { SMS } from '@vonage/sms';
import { BALANCE_URL } from './constants.js';
import { describeError } from './describe-error.js';
import { toVonageMessage } from './to-vonage-message.js';

/**
 * Options accepted by {@link SmsDriverVonage}.
 */
export type SmsDriverVonageConfig = {
	/** API key from the Vonage dashboard. */
	apiKey: string;
	/** API secret of that key. */
	apiSecret: string;
	/** How long a request may take, in milliseconds; the SDK waits without a limit unless given. */
	timeout?: number | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/sms`, so a location naming `vonage` has its options
 * checked against {@link SmsDriverVonageConfig}.
 */
declare module '@novastarter/sms' {
	interface SmsDrivers {
		vonage: SmsDriverVonageConfig;
	}
}

/**
 * Driver for [Vonage](https://www.vonage.com) (formerly Nexmo) on its SMS API.
 *
 * @example
 * ```ts
 * import { useSms } from '@novastarter/sms';
 * import { SmsDriverVonage } from '@novastarter/sms-driver-vonage';
 * import { env } from './env';
 *
 * const sms = useSms();
 *
 * sms.registerDriver('vonage', SmsDriverVonage);
 * sms.registerLocation('main', {
 * 	driver: 'vonage',
 * 	options: {
 * 		apiKey: env.SMS_VONAGE_API_KEY,
 * 		apiSecret: env.SMS_VONAGE_API_SECRET,
 * 	},
 * });
 * ```
 */
export class SmsDriverVonage implements SmsDriver {
	/**
	 * Vonage's SMS client, bound to the location's credentials.
	 *
	 * @internal
	 */
	private readonly client: SMS;

	/**
	 * The credentials, kept for {@link verify}, which reads the account over plain HTTP.
	 *
	 * @internal
	 */
	private readonly credentials: { apiKey: string; apiSecret: string };

	/**
	 * Create a driver on a client of its own for the given key.
	 *
	 * @param config - Credentials.
	 * @throws Error without an API key or its secret.
	 */
	constructor(config: SmsDriverVonageConfig) {
		// 1. Both halves of the credential are needed; report the missing one by the option's name
		if (!config.apiKey) {
			throw new Error('The vonage sms driver needs an "apiKey"');
		}

		if (!config.apiSecret) {
			throw new Error('The vonage sms driver needs an "apiSecret"');
		}

		this.credentials = { apiKey: config.apiKey, apiSecret: config.apiSecret };

		// 2. Only the SMS product is built, not the whole Vonage client: nothing else of the SDK is loaded
		this.client = new SMS(this.credentials, config.timeout !== undefined ? { timeout: config.timeout } : {});
	}

	/**
	 * Send through the Vonage SMS API.
	 *
	 * @param message - Message with its recipient in E.164.
	 * @returns The id of the first part, the status Vonage accepted it with, and how many parts the text became.
	 * @throws Error naming Vonage's status and wording when it refuses the message, the SDK's error as the cause.
	 */
	async send(message: SmsMessage): Promise<SmsResult> {
		// 1. Vonage answers `200` even for a refusal, and the SDK turns a refused part into a throw; `describeError`
		//    keeps Vonage's own status code, which is what an application matches on
		const answer = await this.client.send(toVonageMessage(message)).catch((error: unknown) => {
			throw describeError(error);
		});

		// 2. A long text is split into parts, one entry each; they share an id prefix, so the first one identifies the
		//    message and `messageCount` says how many were billed
		const first = answer.messages[0];

		return {
			...(first?.messageId !== undefined ? { messageId: first.messageId } : {}),
			...(first?.status !== undefined ? { status: first.status } : {}),
			...(answer.messageCount !== undefined ? { segments: answer.messageCount } : {}),
			...(first?.remainingBalance !== undefined ? { response: `balance ${first.remainingBalance}` } : {}),
		};
	}

	/**
	 * Check the credentials without sending.
	 *
	 * @throws Error naming the status when the account cannot be read.
	 */
	async verify(): Promise<void> {
		// 1. The balance endpoint takes the credentials as query parameters and creates nothing; asked with `fetch`
		//    rather than through `@vonage/accounts`, which would be a second SDK for one request
		const query = new URLSearchParams({
			api_key: this.credentials.apiKey,
			api_secret: this.credentials.apiSecret,
		});

		const response = await fetch(`${BALANCE_URL}?${query.toString()}`).catch((error: unknown) => {
			throw describeError(error);
		});

		// 2. Bad credentials answer 401; anything else non-2xx is the API being unreachable or out of order
		if (!response.ok) {
			throw new Error(`Vonage: ${response.status}: ${response.statusText || 'the account could not be read'}`);
		}
	}
}
