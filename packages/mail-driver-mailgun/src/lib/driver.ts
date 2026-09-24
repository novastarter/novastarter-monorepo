import { InvalidConfigError } from '@novastarter/errors';
import { type CallOptions, type CallResponse, DEFAULT_REQUEST_TIMEOUT, type HttpApi, request } from '@novastarter/http';
import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import Mailgun from 'mailgun.js';
import type { Interfaces } from 'mailgun.js/definitions';
import { DEFAULT_MAILGUN_HOST } from './constants.js';
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
	/** Request timeout in milliseconds; 30 s unless given. */
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
	 * Mailgun's API as {@link MailDriverMailgun.call} requests it: the location's host — over https unless given as a
	 * full URL — and no other, the key as HTTP Basic with the user `api`, form bodies, `{domain}` standing for the
	 * location's domain, the location's timeout.
	 *
	 * @internal
	 */
	private readonly api: HttpApi;

	/**
	 * Create a driver on a client of its own for the given key, region and domain.
	 *
	 * @param config - API key, sending domain, region host and test mode.
	 * @throws InvalidConfigError without an API key or a domain.
	 */
	constructor(config: MailDriverMailgunConfig) {
		if (!config.apiKey || !config.domain) {
			throw new InvalidConfigError({ reason: 'The mailgun mail driver needs "apiKey" and "domain"' });
		}

		// The SDK takes a FormData implementation; Node's global one does, no `form-data` package needed. The timeout
		// is always passed: without one the SDK's axios waits forever on a stalled connection, so a send would never
		// fail over to the next location
		const host = config.host || DEFAULT_MAILGUN_HOST;
		const apiUrl = /^https?:\/\//.test(host) ? host : `https://${host}`;
		const timeout = config.timeout ?? DEFAULT_REQUEST_TIMEOUT;

		this.client = new Mailgun(FormData).client({
			username: 'api',
			key: config.apiKey,
			url: apiUrl,
			timeout,
		});

		// Raw calls bypass the SDK, and Mailgun reads forms, not JSON
		this.domain = config.domain;
		this.testMode = Boolean(config.testMode);

		this.api = {
			provider: 'mailgun',
			baseUrl: apiUrl,
			headers: { authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString('base64')}` },
			placeholders: { domain: config.domain },
			timeout,
			bodyType: 'form',
		};
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
		// The payload is built first, so a message the mapper refuses (no sender, unreadable attachment) never reaches
		// the API and the failure names our field rather than Mailgun's
		const data = await toMailgunMessage(message, this.testMode);

		// The SDK throws its `APIError` on any non-2xx; wrapped so the log names the provider
		const result = await this.client.messages.create(this.domain, data).catch(rethrowMailgunError);

		// Mailgun takes a message whole or refuses it, so every recipient counts as accepted
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
	 * @throws Error when the API refuses the key or does not know the domain; InvalidConfigError when the domain is not
	 * active.
	 */
	async verify(): Promise<void> {
		// Reading the domain exercises the key and the domain in one request without sending anything; a refusal is
		// wrapped like a send failure so the log names the provider
		const domain = await this.client.domains.get(this.domain).catch(rethrowMailgunError);

		// An unverified domain sends nothing; Mailgun answers 200 for it all the same
		if (domain.state !== 'active') {
			throw new InvalidConfigError({
				reason: `Mailgun domain "${this.domain}" is ${domain.state}, not active; verify it in Mailgun`,
			});
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
	 * @param params - Its query or body. A `{name}` in the path takes the parameter of that name, URL-encoded,
	 * which is then not sent again.
	 * @param options - A timeout over the location's (30 s unless it set one), an abort signal, extra headers.
	 * @returns The status, the lower-cased headers and Mailgun's answer: parsed JSON, else text; `undefined` when
	 * empty.
	 * @throws ProviderCallError when Mailgun answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Mailgun asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on the location's host.
	 * @example
	 * ```ts
	 * const { data } = await mailgun.call<{ items: unknown[] }>('GET /v3/{domain}/events', { event: 'failed' });
	 *
	 * await mailgun.call('POST /v3/{domain}/unsubscribes', { address: 'ada@example.com', tag: '*' });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// `request()` already handles `{domain}` and the other placeholders, the host check before the key is sent, a
		// form body, the deadline, and the kit's errors without the key
		return request<T>(this.api, method, params, options);
	}
}
