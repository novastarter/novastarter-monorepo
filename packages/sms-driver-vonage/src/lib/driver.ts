import { InvalidConfigError } from '@novastarter/errors';
import { type CallOptions, type CallResponse, type HttpApi, request } from '@novastarter/http';
import type { SmsDriver, SmsMessage, SmsResult } from '@novastarter/sms';
import { SMS } from '@vonage/sms';
import { BALANCE_URL, VONAGE_API_URL, VONAGE_CALL_HOSTS } from './constants.js';
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
 * The driver holds nothing to release, so there is no `close()`: the SDK's client, `verify()` and `call()` go through
 * the global `fetch`, whose connection pool is process-wide rather than owned by the driver.
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
	 * The credentials, kept for {@link verify}, which reads the account balance directly.
	 *
	 * @internal
	 */
	private readonly credentials: { apiKey: string; apiSecret: string };

	/**
	 * How long a request may take, in milliseconds — what the SDK client is built with, and what {@link verify} and
	 * {@link call} apply to their own requests.
	 *
	 * @internal
	 */
	private readonly timeout?: number | undefined;

	/**
	 * Vonage's APIs as a {@link call} reaches them: `rest.nexmo.com` and the newer APIs' hosts, the key pair as a Basic
	 * `Authorization` header — never in the URL — and the location's timeout.
	 *
	 * @internal
	 */
	private readonly api: HttpApi;

	/**
	 * Create a driver on a client of its own for the given key.
	 *
	 * @param config - Credentials.
	 * @throws InvalidConfigError without an API key or its secret.
	 */
	constructor(config: SmsDriverVonageConfig) {
		if (!config.apiKey) {
			throw new InvalidConfigError({ reason: 'The vonage sms driver needs an "apiKey"' });
		}

		if (!config.apiSecret) {
			throw new InvalidConfigError({ reason: 'The vonage sms driver needs an "apiSecret"' });
		}

		// `verify()` reads the account balance directly with these credentials; the timeout bounds that fetch the way
		// the SDK client's own requests are bounded.
		this.credentials = { apiKey: config.apiKey, apiSecret: config.apiSecret };
		this.timeout = config.timeout;

		// Only the SMS product is built, not the whole Vonage client, so nothing else of the SDK is loaded.
		this.client = new SMS(this.credentials, config.timeout !== undefined ? { timeout: config.timeout } : {});

		// `call()` skips the SDK's client, which drops the response headers (`@vonage/server-client` 1.23).
		this.api = {
			provider: 'vonage',
			baseUrl: VONAGE_API_URL,
			hosts: VONAGE_CALL_HOSTS,
			headers: {
				authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`,
			},
			timeout: config.timeout,
		};
	}

	/**
	 * Send through the Vonage SMS API.
	 *
	 * @param message - Message with its recipient in E.164.
	 * @returns The id of the first part, the status Vonage accepted it with, and how many parts the text became.
	 * @throws Error naming Vonage's status and wording when it refuses the message, the SDK's error as the cause.
	 * @throws SmsPartialDeliveryError when Vonage accepts some parts of a long text and refuses the rest — the
	 * delivered parts already went out and are billed, so the message is not to be re-sent through a fallback.
	 */
	async send(message: SmsMessage): Promise<SmsResult> {
		// Vonage answers `200` even for a refusal, and the SDK turns a refused part into a throw; `describeError` keeps
		// Vonage's own status code, which is what an application matches on.
		const answer = await this.client.send(toVonageMessage(message)).catch((error: unknown) => {
			throw describeError(error);
		});

		// The parts of a long text share an id prefix, so the first one identifies the message.
		const first = answer.messages[0];

		// Vonage sends `message-count` as a JSON string and the SDK only renames the key, whatever its typings say.
		const count = answer.messageCount as unknown;
		const segments = Number(count);

		return {
			...(first?.messageId !== undefined ? { messageId: first.messageId } : {}),
			...(first?.status !== undefined ? { status: first.status } : {}),
			...(count != null && count !== '' && Number.isFinite(segments) ? { segments } : {}),
			...(first?.remainingBalance !== undefined ? { response: `balance ${first.remainingBalance}` } : {}),
		};
	}

	/**
	 * Make a request of a Vonage API, with the location's key pair, timeout and the kit's errors.
	 *
	 * The way to what `send()` does not cover — the account balance, pricing, a number search. The `method` is a verb
	 * and a path from `https://rest.nexmo.com`, or a full URL on one of {@link VONAGE_CALL_HOSTS}; the key pair goes as
	 * a Basic `Authorization` header, never in the URL. The parameters are the query of a `GET`, `HEAD` or `DELETE` and
	 * a JSON body otherwise; a `content-type: application/x-www-form-urlencoded` header sends a form instead, for the
	 * account endpoints that take one, and a file among the parameters makes it multipart. A `{name}` in the path is
	 * filled from the parameter of that name, URL-encoded, and that parameter is not sent again.
	 *
	 * @typeParam T - What the request answers with; the caller knows it from Vonage's documentation.
	 * @param method - The verb and the path or full URL: `GET /account/get-balance`.
	 * @param params - The placeholders' values, and its query or body; `undefined` ones are left out.
	 * @param options - A timeout over the location's, an abort signal, extra headers.
	 * @returns The status, the headers — names lower-cased — and Vonage's answer: parsed JSON, else text; `undefined`
	 * for an empty one.
	 * @throws ProviderCallError when Vonage answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Vonage answers `429`.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, a `{name}` placeholder is left unfilled, its URL is not on a Vonage
	 * host, or Vonage cannot be reached — `fetch`'s error, which carries no request header.
	 * @example
	 * ```ts
	 * const sms = useSms().location('vonage');
	 * const { data } = await sms.call!('GET /account/get-pricing/outbound/sms', { country: 'GB' });
	 * const { headers } = await sms.call!('GET /account/get-pricing/outbound/{type}', { type: 'voice' });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// The shared request accepts only Vonage's hosts, so the key pair is never sent to another.
		return request<T>(this.api, method, params, options);
	}

	/**
	 * Check the credentials without sending.
	 *
	 * @throws Error naming the status when the account cannot be read.
	 */
	async verify(): Promise<void> {
		// `fetch` rather than `@vonage/accounts`, which would be a second SDK for one request. The credentials go in a
		// Basic header, never in the URL: a full request URL is what proxies, traces and error output record.
		const headers = {
			Authorization: `Basic ${Buffer.from(`${this.credentials.apiKey}:${this.credentials.apiSecret}`).toString('base64')}`,
		};

		const response = await (
			this.timeout === undefined
				? fetch(BALANCE_URL, { headers })
				: fetch(BALANCE_URL, { headers, signal: AbortSignal.timeout(this.timeout) })
		).catch((error: unknown) => {
			throw describeError(error);
		});

		// Bad credentials answer 401; anything else non-2xx is the API being unreachable or out of order.
		if (!response.ok) {
			throw new Error(`Vonage: ${response.status}: ${response.statusText || 'the account could not be read'}`);
		}

		// An unconsumed body would hold the socket out of `fetch`'s connection pool until GC.
		await response.arrayBuffer();
	}
}
