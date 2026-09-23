import { toProviderCallError } from '@novastarter/errors';
import type { MailDriver, MailMessage, MailResult } from '@novastarter/mail';
import { type CallOptions, parseCallMethod } from '@novastarter/utils';
import { httpCall, resolveCallUrl } from '@novastarter/utils/node';
import { Client, type LibraryResponse, type SendEmailV3_1 } from 'node-mailjet';
import { describeError } from './describe-error.js';
import { toMailjetMessage } from './to-mailjet-message.js';

/**
 * How long a {@link MailDriverMailjet.call} may take unless the caller names another deadline, in milliseconds.
 *
 * @defaultValue 30 seconds.
 */
export const DEFAULT_MAILJET_CALL_TIMEOUT = 30_000;

/**
 * The root of Mailjet's REST API, the one {@link MailDriverMailjet.call} joins a path to.
 *
 * @internal
 */
const MAILJET_API_URL = 'https://api.mailjet.com';

/**
 * The hosts a full URL in {@link MailDriverMailjet.call} may point at: Mailjet's API only, so the key pair never
 * travels anywhere else.
 *
 * @internal
 */
const MAILJET_CALL_HOSTS: readonly string[] = ['api.mailjet.com'];

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
	 * The `Authorization` header of a {@link call}: Basic auth on the key pair, since the SDK cannot request an
	 * arbitrary path.
	 *
	 * @internal
	 */
	private readonly authorization: string;

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

		// 2. The key pair is kept as a ready header for `call()`, the one request that goes around the SDK
		this.authorization = `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`;
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
	 * `POST /v3.1/send`), or a full URL on `api.mailjet.com`. The parameters are the query of a `GET`, `HEAD` or
	 * `DELETE` and the JSON body otherwise. The SDK builds its URLs from a resource and a version and cannot take a
	 * path, so the request is made directly, with Basic auth on the key pair.
	 *
	 * @typeParam T - What the request answers with, from Mailjet's documentation.
	 * @param method - The verb and the path, or a full URL on Mailjet's API host.
	 * @param params - The query or the body.
	 * @param options - A timeout ({@link DEFAULT_MAILJET_CALL_TIMEOUT} unless given), an abort signal, extra headers,
	 * where the parameters go (`paramsIn`).
	 * @returns Mailjet's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError when Mailjet answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Mailjet answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on Mailjet's API host.
	 * @example
	 * ```ts
	 * const contacts = await useMail().location('mailjet').call?.('GET /v3/REST/contact', { Limit: 10 });
	 * ```
	 */
	async call<T = unknown>(method: string, params?: Record<string, unknown>, options: CallOptions = {}): Promise<T> {
		// 1. The method is taken apart and its URL checked before any request, so a foreign host never sees the keys
		const { verb, target } = parseCallMethod(method);
		const url = resolveCallUrl(MAILJET_API_URL, target, MAILJET_CALL_HOSTS);

		// 2. The request with the key pair; the caller's headers go on top of the driver's
		const response = await httpCall({
			url,
			verb,
			params,
			paramsIn: options.paramsIn,
			headers: { authorization: this.authorization, ...options.headers },
			timeout: options.timeout ?? DEFAULT_MAILJET_CALL_TIMEOUT,
			signal: options.signal,
		});

		// 3. A refusal becomes the kit's error; Mailjet's `ErrorMessage` names the reason, and nothing of the request —
		//    the key pair included — goes into it
		if (response.status < 200 || response.status >= 300) {
			throw toProviderCallError({
				provider: 'mailjet',
				method,
				status: response.status,
				body: response.body,
				headers: response.headers,
			});
		}

		return response.body as T;
	}
}
