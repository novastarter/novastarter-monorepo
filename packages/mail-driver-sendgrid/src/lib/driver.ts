import { InvalidConfigError } from '@novastarter/errors';
import { type CallOptions, type CallResponse, type HttpApi, request } from '@novastarter/http';
import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
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
 * The root of SendGrid's v3 API, which the paths of {@link MailDriverSendgrid.call} are joined to.
 *
 * @internal
 */
const SENDGRID_API_URL = 'https://api.sendgrid.com';

/**
 * The hosts besides the root's own a full URL in {@link MailDriverSendgrid.call} may point at: the EU region's API,
 * which a key of an EU subuser must be sent to. The key travels to SendGrid only.
 *
 * @internal
 */
const SENDGRID_CALL_HOSTS: readonly string[] = ['api.eu.sendgrid.com'];

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
	 * SendGrid's v3 API with the location's key as a bearer token, which {@link MailDriverSendgrid.call} requests; no
	 * host besides the root's own, since the key is for SendGrid's global API.
	 *
	 * @internal
	 */
	private readonly api: HttpApi;

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
	 * @throws InvalidConfigError without an API key.
	 */
	constructor(config: MailDriverSendgridConfig) {
		if (!config.apiKey) {
			throw new InvalidConfigError({ reason: 'The sendgrid mail driver needs an "apiKey"' });
		}

		// A client per location, so two keys never share the package-level default; raw calls bypass the SDK, so the key
		// goes to their API too
		this.client = new MailService();
		this.client.setApiKey(config.apiKey);
		this.sandbox = Boolean(config.sandbox);

		this.api = {
			provider: 'sendgrid',
			baseUrl: SENDGRID_API_URL,
			hosts: SENDGRID_CALL_HOSTS,
			headers: { authorization: `Bearer ${config.apiKey}` },
		};
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
		// Translated before the request, so a mapper failure (no sender, unreadable attachment) surfaces the kit's own
		// error instead of a re-wrapped API error
		const mail = await toSendgridMail(message, this.sandbox);

		// The API answers with headers only; the message id lives in one of them
		let response: ClientResponse;

		try {
			[response] = await this.client.send(mail);
		} catch (error) {
			// The SDK throws its `ResponseError` on a refusal; wrapped so the log names the provider
			throw describeError(error);
		}

		const messageId = response.headers['x-message-id'];

		// SendGrid takes a message whole or refuses it, so every recipient counts as accepted
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
	 * `GET`, `HEAD` or `DELETE` — a list repeats its key — and the JSON body otherwise.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from SendGrid's documentation.
	 * @param method - The verb and a path from `https://api.sendgrid.com` (`GET /v3/suppression/bounces`), or a full
	 * URL on that host or `api.eu.sendgrid.com`.
	 * @param params - Its query or body. A `{name}` in the path takes the parameter of that name, URL-encoded,
	 * which is then not sent again.
	 * @param options - A timeout over the default 30 s, an abort signal, extra headers.
	 * @returns The status, the lower-cased headers and SendGrid's answer: parsed JSON, else text; `undefined` when
	 * empty.
	 * @throws ProviderCallError when SendGrid answers with an error status — its status and answer (`errors`) in
	 * `extensions`.
	 * @throws HitRateLimitError when SendGrid asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, its URL is not on SendGrid's host, or SendGrid cannot be reached.
	 * @example
	 * ```ts
	 * const { data } = await sendgrid.call<{ email: string }[]>('GET /v3/suppression/bounces', { limit: 100 });
	 *
	 * await sendgrid.call('POST /v3/asm/suppressions/global', { recipient_emails: ['ada@example.com'] });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		return request<T>(this.api, method, params, options);
	}
}
