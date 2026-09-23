import { type CallOptions, type CallResponse, DEFAULT_REQUEST_TIMEOUT, type HttpApi, request } from '@novastarter/http';
import type { MailDriver, MailMessage, MailResult } from '@novastarter/mail';
import { Client, type LibraryResponse, type SendEmailV3_1 } from 'node-mailjet';
import { describeError } from './describe-error.js';
import { toMailjetMessage } from './to-mailjet-message.js';

/**
 * The root of Mailjet's REST API, the one {@link MailDriverMailjet.call} joins a path to.
 *
 * @internal
 */
const MAILJET_API_URL = 'https://api.mailjet.com';

/**
 * The hosts a full URL in {@link MailDriverMailjet.call} may point at: Mailjet's API and its US region's, so the key
 * pair never travels anywhere else.
 *
 * @internal
 */
const MAILJET_CALL_HOSTS: readonly string[] = ['api.mailjet.com', 'api.us.mailjet.com'];

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
	/**
	 * Request timeout in milliseconds, for sends and for `call()`; 30 s unless given. The SDK waits forever without
	 * one, so a stalled connection would never let `sendMail()` fall back.
	 */
	timeout?: number | undefined;
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
	 * Mailjet's API as {@link MailDriverMailjet.call} requests it: Basic auth on the key pair, since the SDK cannot
	 * request an arbitrary path, and `api.mailjet.com` and `api.us.mailjet.com` as the only hosts.
	 *
	 * @internal
	 */
	private readonly api: HttpApi;

	/**
	 * Create a driver on a client of its own for the given key pair.
	 *
	 * @param config - API key pair, sandbox switch and timeout.
	 * @throws Error without both keys.
	 */
	constructor(config: MailDriverMailjetConfig) {
		// 1. Both keys are needed for a request; a missing one is reported by the options' names
		if (!config.apiKey || !config.apiSecret) {
			throw new Error('The mailjet mail driver needs "apiKey" and "apiSecret"');
		}

		// 2. The SDK sets no timeout of its own (axios' `0`, wait forever), so one is always passed: a stalled
		//    connection then fails the send and `sendMail()` can fall back to the next location
		const timeout = config.timeout ?? DEFAULT_REQUEST_TIMEOUT;

		this.client = new Client({ apiKey: config.apiKey, apiSecret: config.apiSecret, options: { timeout } });
		this.sandbox = Boolean(config.sandbox);

		// 3. The key pair and the timeout also go to the API of `call()`, the one request that goes around the SDK
		const basic = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');

		this.api = {
			provider: 'mailjet',
			baseUrl: MAILJET_API_URL,
			hosts: MAILJET_CALL_HOSTS,
			headers: { authorization: `Basic ${basic}` },
			timeout,
		};
	}

	/**
	 * Send through Mailjet's Send API.
	 *
	 * @param message - Rendered message.
	 * @returns The message ids Mailjet assigned per recipient (the first as `messageId`), accepted recipients.
	 * @throws Error listing Mailjet's per-message errors, the response body as the `cause`, when the status is not
	 * `success`; an error naming Mailjet with the SDK's error as the cause when the request itself fails.
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

		// 3. A rejected message comes back with status 200 and `Status: 'error'`; that is a failure for `sendMail()`,
		//    the body kept as the cause so the refusal stays inspectable
		if (!sent || sent.Status !== 'success') {
			const errors = (sent?.Errors ?? []).map((error) => error.ErrorMessage ?? JSON.stringify(error));

			throw new Error(`Mailjet: ${errors.join('; ') || `status ${sent?.Status ?? 'unknown'}`}`, {
				cause: result.body,
			});
		}

		// 4. Mailjet reports every recipient it took, with a message id each. A message that came back `success` was
		//    taken whole, so unlike the envelope-recipient drivers there is no rejected list to report: `accepted` is
		//    the provider's list and `rejected` stays empty on purpose
		const delivered = [...(sent.To ?? []), ...(sent.Cc ?? []), ...(sent.Bcc ?? [])];

		return {
			messageId: delivered[0]?.MessageID !== undefined ? String(delivered[0].MessageID) : undefined,
			accepted: delivered.map((recipient) => recipient.Email),
			rejected: [],
			response: sent.Status,
		};
	}

	/**
	 * Make a request of Mailjet's own API with the location's key pair — the way to contacts, statistics, senders and
	 * anything else the driver has no wrapper for.
	 *
	 * `method` is the verb and a path from `https://api.mailjet.com`, the API version included (`GET /v3/REST/contact`,
	 * `POST /v3.1/send`), or a full URL on `api.mailjet.com` or `api.us.mailjet.com`. The parameters are the query of
	 * a `GET`, `HEAD` or `DELETE` and the JSON body otherwise. The SDK builds its URLs from a resource and a version
	 * and cannot take a path, so the request is made directly, with Basic auth on the key pair.
	 *
	 * @typeParam T - What the request answers with, from Mailjet's documentation.
	 * @param method - The verb and the path, or a full URL on Mailjet's API host.
	 * @param params - The query or the body. A `{name}` in the path takes the parameter of that name, URL-encoded,
	 * which is then not sent again.
	 * @param options - A timeout over the location's (30 s unless it set one), an abort signal, extra headers.
	 * @returns The status, the lower-cased headers and Mailjet's answer: parsed JSON, else text; `undefined` when
	 * empty.
	 * @throws ProviderCallError when Mailjet answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Mailjet answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on Mailjet's API host.
	 * @example
	 * ```ts
	 * const { data } = await useMail().location('mailjet').call!('GET /v3/REST/contact', { Limit: 10 });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// 1. `request()` does the whole of it — placeholders, the host check before the keys are sent, the deadline,
		//    the kit's errors with Mailjet's `ErrorMessage` and without the keys — over the constructor's API
		return request<T>(this.api, method, params, options);
	}
}
