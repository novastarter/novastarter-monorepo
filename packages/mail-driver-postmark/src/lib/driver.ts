import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import { ServerClient } from 'postmark';
import { describeError } from './describe-error.js';
import { type PostmarkStreams, toPostmarkMessage } from './to-postmark-message.js';

/**
 * Options accepted by {@link MailDriverPostmark}.
 */
export type MailDriverPostmarkConfig = {
	/** Server API token from the Postmark server's "API Tokens" tab. */
	serverToken: string;
	/** Message stream transactional mail goes to; Postmark's default transactional stream (`outbound`) unless given. */
	messageStream?: string | undefined;
	/** Message stream `marketing` mail goes to — a broadcast stream; `messageStream` unless given. */
	broadcastStream?: string | undefined;
	/** Request timeout in seconds; the SDK's default unless given. */
	timeout?: number | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `postmark` has its options
 * checked against {@link MailDriverPostmarkConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		postmark: MailDriverPostmarkConfig;
	}
}

/**
 * Driver for [Postmark](https://postmarkapp.com), through the official `postmark` SDK.
 *
 * @example
 * ```ts
 * import { useMail } from '@novastarter/mail';
 * import { MailDriverPostmark } from '@novastarter/mail-driver-postmark';
 * import { env } from './env';
 *
 * const mail = useMail();
 *
 * mail.registerDriver('postmark', MailDriverPostmark);
 * mail.registerLocation('main', {
 * 	driver: 'postmark',
 * 	options: {
 * 		serverToken: env.MAIL_POSTMARK_SERVER_TOKEN,
 * 		broadcastStream: 'newsletter',
 * 	},
 * });
 * ```
 */
export class MailDriverPostmark implements MailDriver {
	/**
	 * Postmark's server client, bound to the location's token.
	 *
	 * @internal
	 */
	private readonly client: ServerClient;

	/**
	 * The stream per category, as the location was registered with.
	 *
	 * @internal
	 */
	private readonly streams: PostmarkStreams;

	/**
	 * Create a driver on a client of its own for the given token.
	 *
	 * @param config - Server token, streams and timeout.
	 * @throws Error without a server token.
	 */
	constructor(config: MailDriverPostmarkConfig) {
		// 1. A missing token is a configuration error; report it by the option's name
		if (!config.serverToken) {
			throw new Error('The postmark mail driver needs a "serverToken"');
		}

		// 2. The SDK's `Configuration` is `(useHttps, requestHost, timeout)`; only the timeout is ours to set
		this.client = new ServerClient(
			config.serverToken,
			config.timeout !== undefined ? { timeout: config.timeout } : undefined,
		);

		this.streams = { messageStream: config.messageStream, broadcastStream: config.broadcastStream };
	}

	/**
	 * Send through the Postmark Email API.
	 *
	 * @param message - Rendered message.
	 * @returns Postmark's message id; every recipient as accepted — a refused recipient fails the whole request.
	 * @throws An error naming Postmark with the SDK's error as the cause (`PostmarkError` with `code` and
	 * `statusCode`; `InactiveRecipientsError` names the suppressed recipients) when the API refuses.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. Translate first, so a message Postmark cannot take fails before the request
		let response: Awaited<ReturnType<ServerClient['sendEmail']>>;

		try {
			response = await this.client.sendEmail(await toPostmarkMessage(message, this.streams));
		} catch (error) {
			// 2. The SDK throws on a refusal; wrapped so the log names the provider, the SDK's error as the cause
			throw describeError(error);
		}

		// 3. Postmark takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: response.MessageID,
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
			response: response.Message,
		};
	}

	/**
	 * Check the token without sending: the server it belongs to has to answer.
	 *
	 * @throws An error naming Postmark with the SDK's error (`InvalidAPIKeyError` for a bad token) as the cause when
	 * Postmark refuses.
	 */
	async verify(): Promise<void> {
		// 1. The cheapest authenticated call: the server's own record
		await this.client.getServer().catch((error: unknown) => {
			throw describeError(error);
		});
	}
}
