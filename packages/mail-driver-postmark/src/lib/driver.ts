import { type CallOptions, type CallResponse, type HttpApi, request } from '@novastarter/http';
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
 * The root of Postmark's API, which the paths of {@link MailDriverPostmark.call} are joined to.
 *
 * @internal
 */
const POSTMARK_API_URL = 'https://api.postmarkapp.com';

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
	 * Postmark's server API with the location's token in `X-Postmark-Server-Token`, which
	 * {@link MailDriverPostmark.call} requests under the location's timeout; no host besides the root's own, since
	 * Postmark serves its server API from one host.
	 *
	 * @internal
	 */
	private readonly api: HttpApi;

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

		// 3. The streams per category, and the API of raw calls, which bypass the SDK — the location's timeout is in
		//    seconds, the API's in milliseconds
		this.streams = { messageStream: config.messageStream, broadcastStream: config.broadcastStream };

		this.api = {
			provider: 'postmark',
			baseUrl: POSTMARK_API_URL,
			headers: { 'x-postmark-server-token': config.serverToken },
			timeout: config.timeout === undefined ? undefined : config.timeout * 1000,
		};
	}

	/**
	 * Send through the Postmark Email API.
	 *
	 * @param message - Rendered message.
	 * @returns Postmark's message id; every recipient as accepted — a refused recipient fails the whole request.
	 * @throws An error naming Postmark with the SDK's error as the cause (`PostmarkError` with `code` and
	 * `statusCode`; `InactiveRecipientsError` names the suppressed recipients) when the API refuses; the mapper's
	 * own error unchanged when the message cannot be built.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. Translate first, so a failure of the mapper (no sender, unreadable attachment) surfaces the kit's own
		//    error before the request instead of a re-wrapped API error
		const postmarkMessage = await toPostmarkMessage(message, this.streams);

		let response: Awaited<ReturnType<ServerClient['sendEmail']>>;

		try {
			response = await this.client.sendEmail(postmarkMessage);
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

	/**
	 * Make a request of Postmark's server API with the location's token — the way to bounces, suppressions, templates,
	 * message streams, stats and whatever else the driver has no wrapper for.
	 *
	 * The request goes over `fetch` rather than the SDK's HTTP client, which takes neither a per-request timeout nor an
	 * abort signal. The parameters are the query of a `GET`, `HEAD` or `DELETE` and the JSON body otherwise. The server
	 * token is sent, so the account API — which takes an account token — is out of reach.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from Postmark's documentation.
	 * @param method - The verb and a path from `https://api.postmarkapp.com` (`GET /bounces`), or a full URL on that
	 * host.
	 * @param params - Its query or body. A `{name}` in the path takes the parameter of that name, URL-encoded,
	 * which is then not sent again.
	 * @param options - A timeout over the location's (30 s unless it set one), an abort signal, extra headers.
	 * @returns The status, the lower-cased headers and Postmark's answer: parsed JSON, else text; `undefined` when
	 * empty.
	 * @throws ProviderCallError when Postmark answers with an error status — its status and answer (`ErrorCode`,
	 * `Message`) in `extensions`.
	 * @throws HitRateLimitError when Postmark asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on Postmark's host.
	 * @example
	 * ```ts
	 * const { data } = await postmark.call<{ TotalCount: number }>('GET /bounces', { count: 50, offset: 0 });
	 *
	 * await postmark.call('PUT /bounces/{id}/activate', { id: 692560173 });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// 1. `request()` does the whole of it — placeholders, the host check before the token is sent, the deadline,
		//    the kit's errors without the token — over the API the constructor described
		return request<T>(this.api, method, params, options);
	}
}
