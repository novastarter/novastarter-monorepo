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
import Mailgun from 'mailgun.js';
import type { Interfaces } from 'mailgun.js/definitions';
import { DEFAULT_MAILGUN_CALL_TIMEOUT, DEFAULT_MAILGUN_HOST } from './constants.js';
import { rethrowMailgunError } from './describe-error.js';
import { toMailgunMessage } from './to-mailgun-message.js';

/**
 * Options accepted by {@link MailDriverMailgun}.
 */
export type MailDriverMailgunConfig = {
	/** Private API key from the Mailgun dashboard. */
	apiKey: string;
	/** Sending domain the messages go out from (`mg.example.com`). */
	domain: string;
	/**
	 * API host: `api.mailgun.net` (the default) for the US region, `api.eu.mailgun.net` for the EU one. A full URL
	 * (`http://localhost:8080`) is taken as is, for a local stand-in of the API.
	 */
	host?: string | undefined;
	/** Accept the messages without delivering them — Mailgun's test mode (`o:testmode`). */
	testMode?: boolean | undefined;
	/** Request timeout in milliseconds; the SDK's default unless given. */
	timeout?: number | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `mailgun` has its options
 * checked against {@link MailDriverMailgunConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		mailgun: MailDriverMailgunConfig;
	}
}

/**
 * Driver for [Mailgun](https://www.mailgun.com), through the official `mailgun.js` SDK.
 *
 * The SDK is called directly, the way the other API drivers of the kit do, so the tags and the test mode reach
 * Mailgun and no nodemailer transport package is needed.
 *
 * @example
 * ```ts
 * import { useMail } from '@novastarter/mail';
 * import { MailDriverMailgun } from '@novastarter/mail-driver-mailgun';
 * import { env } from './env';
 *
 * const mail = useMail();
 *
 * mail.registerDriver('mailgun', MailDriverMailgun);
 * mail.registerLocation('main', {
 * 	driver: 'mailgun',
 * 	options: {
 * 		apiKey: env.MAIL_MAILGUN_API_KEY,
 * 		domain: 'mg.example.com',
 * 		host: 'api.eu.mailgun.net',
 * 	},
 * });
 * ```
 */
export class MailDriverMailgun implements MailDriver {
	/**
	 * Mailgun's client, bound to the location's key and region.
	 *
	 * @internal
	 */
	private readonly client: Interfaces.IMailgunClient;

	/**
	 * Sending domain every message goes out from.
	 *
	 * @internal
	 */
	private readonly domain: string;

	/**
	 * Whether every message is sent in test mode.
	 *
	 * @internal
	 */
	private readonly testMode: boolean;

	/**
	 * The API root raw calls are made against — the location's host, over https unless given as a full URL — and the
	 * only host a full URL given to {@link MailDriverMailgun.call} may point at.
	 *
	 * @internal
	 */
	private readonly apiUrl: string;

	/**
	 * The `Authorization` header of raw calls: HTTP Basic with the user `api` and the location's key.
	 *
	 * @internal
	 */
	private readonly authorization: string;

	/**
	 * The location's request timeout in milliseconds, when it set one; the default of raw calls otherwise.
	 *
	 * @internal
	 */
	private readonly timeout: number | undefined;

	/**
	 * Create a driver on a client of its own for the given key, region and domain.
	 *
	 * @param config - API key, sending domain, region host and test mode.
	 * @throws Error without an API key or a domain.
	 */
	constructor(config: MailDriverMailgunConfig) {
		// 1. Both the key and the domain are needed for a request; a missing one is reported by the options' names
		if (!config.apiKey || !config.domain) {
			throw new Error('The mailgun mail driver needs "apiKey" and "domain"');
		}

		// 2. The SDK takes a FormData implementation; Node's global one does, no `form-data` package needed
		const host = config.host || DEFAULT_MAILGUN_HOST;

		this.apiUrl = /^https?:\/\//.test(host) ? host : `https://${host}`;

		this.client = new Mailgun(FormData).client({
			username: 'api',
			key: config.apiKey,
			url: this.apiUrl,
			...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
		});

		// 3. The rest of the location, and the credentials and timeout for raw calls, which bypass the SDK
		this.domain = config.domain;
		this.testMode = Boolean(config.testMode);
		this.authorization = `Basic ${Buffer.from(`api:${config.apiKey}`).toString('base64')}`;
		this.timeout = config.timeout;
	}

	/**
	 * Send through the Mailgun Messages API.
	 *
	 * @param message - Rendered message.
	 * @returns Mailgun's message id (without the angle brackets) and its `Queued.` line; every recipient as accepted,
	 * since the API takes all or nothing.
	 * @throws Error carrying Mailgun's status and details when the API refuses; the SDK's error is the cause.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. The payload is built first, so a message the mapper refuses (no sender, unreadable attachment) never
		//    reaches the API and the failure names our field rather than Mailgun's
		const data = await toMailgunMessage(message, this.testMode);

		// 2. The SDK throws its `APIError` on any non-2xx; wrapped so the log names the provider
		const result = await this.client.messages.create(this.domain, data).catch(rethrowMailgunError);

		// 3. Mailgun takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: result.id?.replace(/^<|>$/g, ''),
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
			response: result.message,
		};
	}

	/**
	 * Check the key and the domain without sending: the domain has to exist on the account and be active.
	 *
	 * @throws Error when the API refuses the key, does not know the domain, or the domain is not active.
	 */
	async verify(): Promise<void> {
		// 1. Reading the domain exercises the key and the domain in one request without sending anything; a refusal
		//    is wrapped like a send failure so the log names the provider
		const domain = await this.client.domains.get(this.domain).catch(rethrowMailgunError);

		// 2. An unverified domain sends nothing; Mailgun answers 200 for it all the same
		if (domain.state !== 'active') {
			throw new Error(`Mailgun domain "${this.domain}" is ${domain.state}, not active`);
		}
	}

	/**
	 * Make a request of Mailgun's API with the location's key — the way to events, suppressions, templates, stats and
	 * whatever else the driver has no wrapper for.
	 *
	 * The request goes over `fetch` rather than the SDK's `request`, which takes no per-request timeout, abort signal or
	 * headers, and reports an unreachable host as a status 400. `{domain}` in the path stands for the location's domain.
	 * The parameters are the query of a `GET`, `HEAD` or `DELETE` and a form body otherwise — the way Mailgun's API reads
	 * them, a list repeating its key; a `Blob` or `File` among them sends it as multipart.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from Mailgun's documentation.
	 * @param method - The verb and a path from the location's host (`GET /v3/{domain}/bounces`), or a full URL on that
	 * host.
	 * @param params - Its query or body.
	 * @param options - A timeout over the location's (30 s unless it set one), an abort signal, extra headers,
	 * where the parameters go (`paramsIn`).
	 * @returns Mailgun's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError when Mailgun answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Mailgun asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on the location's host.
	 * @example
	 * ```ts
	 * const events = await mailgun.call<{ items: unknown[] }>('GET /v3/{domain}/events', { event: 'failed', limit: 50 });
	 *
	 * await mailgun.call('POST /v3/{domain}/unsubscribes', { address: 'ada@example.com', tag: '*' });
	 * ```
	 */
	async call<T = unknown>(method: string, params?: Record<string, unknown>, options: CallOptions = {}): Promise<T> {
		// 1. The verb and the URL, `{domain}` filled in, checked before any request so the key never travels to a host
		//    other than the location's
		const { verb, target } = parseCallMethod(method);
		const url = resolveCallUrl(this.apiUrl, target.replaceAll('{domain}', this.domain));

		// 2. The request with the key as HTTP Basic, the caller's headers on top, a form body, under the deadline
		const response = await httpCall({
			url,
			verb,
			params,
			paramsIn: options.paramsIn,
			headers: { authorization: this.authorization, ...options.headers },
			bodyType: 'form',
			timeout: options.timeout ?? this.timeout ?? DEFAULT_MAILGUN_CALL_TIMEOUT,
			signal: options.signal,
		});

		// 3. A non-2xx answer becomes the kit's error; it carries the method and Mailgun's answer, never the key
		if (response.status < 200 || response.status >= 300) {
			throw toProviderCallError({
				provider: 'mailgun',
				method,
				status: response.status,
				body: response.body,
				headers: response.headers,
			});
		}

		return response.body as T;
	}
}
