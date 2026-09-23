import { toProviderCallError } from '@novastarter/errors';
import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import { type CallOptions, parseCallMethod } from '@novastarter/utils';
import { httpCall, resolveCallUrl } from '@novastarter/utils/node';
import { type ClientResponse, MailService } from '@sendgrid/mail';
import { describeError } from './describe-error.js';
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
 * How long a {@link MailDriverSendgrid.call} request may take when the caller names no timeout, in milliseconds.
 *
 * @defaultValue 30 000 ms.
 */
export const DEFAULT_SENDGRID_CALL_TIMEOUT = 30_000;

/**
 * The root of SendGrid's v3 API, which the paths of {@link MailDriverSendgrid.call} are joined to.
 *
 * @internal
 */
const SENDGRID_API_URL = 'https://api.sendgrid.com';

/**
 * The hosts a full URL given to {@link MailDriverSendgrid.call} may point at, besides the API root's own: none, since
 * the driver's key is for SendGrid's global API.
 *
 * @internal
 */
const SENDGRID_CALL_HOSTS: readonly string[] = [];

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
	 * The location's API key, kept for the `Authorization` header of {@link MailDriverSendgrid.call}.
	 *
	 * @internal
	 */
	private readonly apiKey: string;

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

		// 2. A client per location, so two keys never share the package-level default; the key is also kept for raw
		//    calls, which bypass the SDK
		this.apiKey = config.apiKey;
		this.client = new MailService();
		this.client.setApiKey(config.apiKey);
		this.sandbox = Boolean(config.sandbox);
	}

	/**
	 * Send through the SendGrid API.
	 *
	 * @param message - Rendered message.
	 * @returns SendGrid's message id from the `x-message-id` header; every recipient as accepted.
	 * @throws An error naming SendGrid with the SDK's error as the cause (`response.body` describes the rejection)
	 * when the API refuses; the mapper's own error unchanged when the message cannot be built.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. The message is translated before the request, so a failure of the mapper (no sender, unreadable
		//    attachment) surfaces the kit's own error instead of a re-wrapped API error
		const mail = await toSendgridMail(message, this.sandbox);

		// 2. The API answers with headers only; the message id lives in one of them
		let response: ClientResponse;

		try {
			[response] = await this.client.send(mail);
		} catch (error) {
			// 3. The SDK throws its `ResponseError` on a refusal; wrapped so the log names the provider
			throw describeError(error);
		}

		const messageId = response.headers['x-message-id'];

		// 4. SendGrid takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: typeof messageId === 'string' ? messageId : undefined,
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
			response: `${response.statusCode}`,
		};
	}

	/**
	 * Make a request of SendGrid's v3 API with the location's key — the way to suppressions, bounces, templates, stats
	 * and whatever else the driver has no wrapper for.
	 *
	 * The request goes over `fetch` rather than the SDK's client, which takes no abort signal: here a timeout or an
	 * abort stops the request itself, and a signal already aborted sends nothing. The parameters are the query of a
	 * `GET`, `HEAD` or `DELETE` — a list repeats its key — and the JSON body otherwise, unless `options.paramsIn` says
	 * where they go.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from SendGrid's documentation.
	 * @param method - The verb and a path from `https://api.sendgrid.com` (`GET /v3/suppression/bounces`), or a full
	 * URL on that host.
	 * @param params - Its query or body.
	 * @param options - A timeout over the default 30 s, an abort signal, extra headers, where the parameters go
	 * (`paramsIn`).
	 * @returns SendGrid's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError when SendGrid answers with an error status — its status and answer (`errors`) in
	 * `extensions`.
	 * @throws HitRateLimitError when SendGrid asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, its URL is not on SendGrid's host, or SendGrid cannot be reached.
	 * @example
	 * ```ts
	 * const bounces = await sendgrid.call<{ email: string }[]>('GET /v3/suppression/bounces', { limit: 100 });
	 *
	 * await sendgrid.call('POST /v3/asm/suppressions/global', { recipient_emails: ['ada@example.com'] });
	 *
	 * await sendgrid.call('DELETE /v3/suppression/bounces', { emails: ['ada@example.com'] }, { paramsIn: 'body' });
	 * ```
	 */
	async call<T = unknown>(method: string, params?: Record<string, unknown>, options: CallOptions = {}): Promise<T> {
		// 1. The verb and the URL, checked before any request so the key never travels to a host other than SendGrid's
		const { verb, target } = parseCallMethod(method);
		const url = resolveCallUrl(SENDGRID_API_URL, target, SENDGRID_CALL_HOSTS);

		// 2. The request with the key as a bearer token, the caller's headers on top, under the deadline; `paramsIn`
		//    lets the caller reach an endpoint that reads a `DELETE` body, such as the bulk bounce removal
		const response = await httpCall({
			url,
			verb,
			params,
			paramsIn: options.paramsIn,
			headers: { authorization: `Bearer ${this.apiKey}`, ...options.headers },
			timeout: options.timeout ?? DEFAULT_SENDGRID_CALL_TIMEOUT,
			signal: options.signal,
		});

		// 3. A non-2xx answer becomes the kit's error; it carries the method and SendGrid's `errors`, never the key
		if (response.status < 200 || response.status >= 300) {
			throw toProviderCallError({
				provider: 'sendgrid',
				method,
				status: response.status,
				body: response.body,
				headers: response.headers,
			});
		}

		return response.body as T;
	}
}
