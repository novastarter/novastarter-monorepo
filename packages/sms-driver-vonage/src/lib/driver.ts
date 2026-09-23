import { toProviderCallError } from '@novastarter/errors';
import type { SmsDriver, SmsMessage, SmsResult } from '@novastarter/sms';
import { type CallOptions, callParamsIn, type CallVerb, parseCallMethod, withTimeout } from '@novastarter/utils';
import { httpCall, resolveCallUrl, toQueryString } from '@novastarter/utils/node';
import { SMS } from '@vonage/sms';
import {
	BALANCE_URL,
	DEFAULT_VONAGE_CALL_TIMEOUT,
	VONAGE_API_URL,
	VONAGE_CALL_HOSTS,
	VONAGE_FORM_TYPE,
	VONAGE_JSON_TYPE,
} from './constants.js';
import { describeError } from './describe-error.js';
import { toVonageMessage } from './to-vonage-message.js';

/**
 * The request the SDK client's `sendRequest()` takes; spelled through the client, since `@vonage/vetch`, where it is
 * declared, is not a dependency of this package.
 *
 * @internal
 */
type VonageRequest = Parameters<SMS['sendRequest']>[0];

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
 * The driver holds nothing to release, so there is no `close()`: the SDK's client and `verify()` go through the
 * global `fetch`, whose connection pool is process-wide rather than owned by the driver.
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
	 * The credentials, kept for {@link verify}, which reads the account balance directly, and for the uploads
	 * {@link call} makes without the SDK's client.
	 *
	 * @internal
	 */
	private readonly credentials: { apiKey: string; apiSecret: string };

	/**
	 * How long a request may take, in milliseconds — what the SDK client is built with and {@link verify} applies to
	 * its own `fetch`, which takes no other deadline.
	 *
	 * @internal
	 */
	private readonly timeout?: number | undefined;

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

		// 2. The credentials are kept for `verify()`, which reads the account balance directly; the timeout bounds that
		//    fetch the way the SDK client's own requests are bounded
		this.credentials = { apiKey: config.apiKey, apiSecret: config.apiSecret };
		this.timeout = config.timeout;

		// 3. Only the SMS product is built, not the whole Vonage client: nothing else of the SDK is loaded
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
	 * Make a request of a Vonage API through the SDK's client, with the location's key pair, timeout and the kit's
	 * errors.
	 *
	 * The way to what `send()` does not cover — the account balance, pricing, a number search. The `method` is a verb
	 * and a path from `https://rest.nexmo.com`, or a full URL on one of {@link VONAGE_CALL_HOSTS}; the key pair goes as
	 * a Basic `Authorization` header, never in the URL. The parameters are the query of a `GET`, `HEAD` or `DELETE` and
	 * a JSON body otherwise — `options.paramsIn` moves them; a `content-type: application/x-www-form-urlencoded` header
	 * sends a form instead, for the account endpoints that take one.
	 *
	 * A file — a `Blob` or `File` among the parameters, or in a list of them — is uploaded as a multipart body. The
	 * SDK's client sends no multipart body, so that request is made without it, with the same key pair, host check,
	 * deadline and errors; the caller's content type is dropped for the multipart one.
	 *
	 * @typeParam T - What the request answers with; the caller knows it from Vonage's documentation.
	 * @param method - The verb and the path or full URL: `GET /account/get-balance`.
	 * @param params - Its query or body; `undefined` ones are left out.
	 * @param options - A timeout over the location's, an abort signal, extra headers, where the parameters go.
	 * @returns Vonage's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError when Vonage answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Vonage answers `429`.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, its URL is not on a Vonage host, the content type is neither JSON nor
	 * a form, a file is put in the query, or a successful answer cannot be decoded.
	 * @example
	 * ```ts
	 * const sms = useSms().location('vonage');
	 * const pricing = await sms.call!('GET /account/get-pricing/outbound/sms', { country: 'GB' });
	 * ```
	 */
	async call<T = unknown>(method: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
		// 1. The method checked and resolved before anything is sent: a URL on a foreign host is refused with the key
		//    pair never used
		const { verb, target } = parseCallMethod(method);
		const url = resolveCallUrl(VONAGE_API_URL, target, VONAGE_CALL_HOSTS);

		// 2. The query carries the parameters of the verbs without a body, unless the caller said otherwise — lists
		//    repeated, objects as JSON, which the SDK's own query handling would flatten to `[object Object]`; the rest
		//    go as the body
		const defined = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
		const inQuery = callParamsIn(verb, options.paramsIn) === 'query';

		// 3. A file goes as a multipart body, which the SDK's client cannot send: the upload is made without it. A file
		//    has no place in a query, so one there is refused rather than sent as the text of an empty object
		if (hasFile(defined)) {
			if (inQuery) {
				throw new Error(`The vonage call sends a file in a body only, not in the query of ${verb}`);
			}

			return this.upload<T>(method, url, verb, defined, options);
		}

		// 4. Otherwise the query is filled here
		if (inQuery) {
			for (const [key, value] of new URLSearchParams(toQueryString(defined)).entries()) {
				url.searchParams.append(key, value);
			}
		}

		// 5. JSON unless the caller asks for a form; the SDK sets the content type from `type` itself — and sends no
		//    body for any other — so the caller's is normalized, checked and taken out of the headers
		const headers: Record<string, string> = {};
		let type = VONAGE_JSON_TYPE;

		for (const [name, value] of Object.entries(options.headers ?? {})) {
			if (name.toLowerCase() === 'content-type') {
				type = value.split(';')[0]?.trim().toLowerCase() ?? '';
			} else {
				headers[name] = value;
			}
		}

		if (type !== VONAGE_JSON_TYPE && type !== VONAGE_FORM_TYPE) {
			throw new Error(`The vonage call sends a JSON or form body only, not "${type}"`);
		}

		const timeout = options.timeout ?? this.timeout ?? DEFAULT_VONAGE_CALL_TIMEOUT;

		const request = {
			method: verb,
			url: url.href,
			type,
			headers,
			timeout,
			...(inQuery ? {} : { data: defined }),
		} as unknown as VonageRequest;

		// 6. The SDK adds the Basic header and aborts at its own timeout; the deadline enforces the timeout as the
		//    kit's `TimeoutError` and honours the caller's abort — an already aborted signal sends nothing
		let response: { status: number; data: unknown };

		try {
			response = await withTimeout(
				() => this.client.sendRequest(request),
				timeout,
				options.signal ? { signal: options.signal } : {},
			);
		} catch (error) {
			throw await toVonageCallError(error, method);
		}

		// 7. An empty answer is nothing; the SDK decodes JSON by its content type and hands anything else as text
		return (response.data === '' || response.data === null ? undefined : response.data) as T;
	}

	/**
	 * Upload a file for {@link call}: a multipart request made with `httpCall`, since the SDK's client sends none.
	 *
	 * The key pair goes as a Basic header, as the SDK sends it; redirects are followed without it leaving the origin,
	 * and the deadline covers the reading of the answer.
	 *
	 * @typeParam T - What the request answers with.
	 * @param method - The method as the caller wrote it, for the error.
	 * @param url - The URL, already checked to be on a Vonage host.
	 * @param verb - The verb.
	 * @param params - The defined parameters, a file among them.
	 * @param options - The timeout, the signal, the caller's headers and where the parameters go.
	 * @returns Vonage's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError, or HitRateLimitError for a 429, when Vonage answers with an error status.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when Vonage cannot be reached — `fetch`'s error, which carries no request header.
	 * @internal
	 */
	private async upload<T>(
		method: string,
		url: URL,
		verb: CallVerb,
		params: Record<string, unknown>,
		options: CallOptions,
	): Promise<T> {
		// 1. The key pair as the SDK sends it, the caller's headers on top; `httpCall` builds the multipart body and
		//    its type
		const { apiKey, apiSecret } = this.credentials;

		const response = await httpCall({
			url,
			verb,
			params,
			paramsIn: options.paramsIn,
			headers: {
				authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
				...options.headers,
			},
			timeout: options.timeout ?? this.timeout ?? DEFAULT_VONAGE_CALL_TIMEOUT,
			signal: options.signal,
		});

		// 2. A non-2xx answer becomes the kit's error, Vonage's answer as the body; no header sent — the key pair —
		//    goes into it
		if (response.status < 200 || response.status >= 300) {
			throw toProviderCallError({
				provider: 'vonage',
				method,
				status: response.status,
				body: response.body,
				headers: response.headers,
			});
		}

		return response.body as T;
	}

	/**
	 * Check the credentials without sending.
	 *
	 * @throws Error naming the status when the account cannot be read.
	 */
	async verify(): Promise<void> {
		// 1. The balance endpoint accepts the credentials as a Basic `Authorization` header and creates nothing; it is
		//    asked with `fetch` rather than through `@vonage/accounts`, which would be a second SDK for one request.
		//    A timeout, when the location sets one, bounds this fetch too — the SDK client's own requests are bounded
		//    the same way. The credentials never go in the URL: a full request URL is what proxies, traces and error
		//    output record, and the account's secret must not leak into any of those
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

		// 2. Bad credentials answer 401; anything else non-2xx is the API being unreachable or out of order
		if (!response.ok) {
			throw new Error(`Vonage: ${response.status}: ${response.statusText || 'the account could not be read'}`);
		}
	}
}

/**
 * Whether the parameters carry a file — a `Blob` or `File` — at the top level or in a list, which makes the request a
 * multipart upload.
 *
 * @param params - The defined parameters.
 * @returns `true` when a file is among them.
 * @internal
 */
const hasFile = (params: Record<string, unknown>): boolean => {
	// 1. The two places `httpCall` turns into multipart parts: a parameter itself, or an item of a list
	return Object.values(params).some(
		(value) => value instanceof Blob || (Array.isArray(value) && value.some((item) => item instanceof Blob)),
	);
};

/**
 * Turn what the SDK's `sendRequest()` threw into the kit's error.
 *
 * The SDK throws a `VetchError` for a non-2xx answer, the `Response` in its `response`; it is recognised by that
 * shape, since `@vonage/vetch` is not a dependency. The `VetchError` is not kept as the cause: its `config` holds the
 * request as sent, the `Authorization` header with the key pair included, and a logger printing the cause would
 * print the secret.
 *
 * @param error - What was thrown.
 * @param method - The method as the caller wrote it.
 * @returns A `ProviderCallError` or `HitRateLimitError` for an error status; a plain error, without the `VetchError`,
 * for a successful answer the SDK could not decode; anything else — a timeout, a network failure — as it was thrown.
 * @internal
 */
const toVonageCallError = async (error: unknown, method: string): Promise<unknown> => {
	// 1. Only an answer with a status is the provider's refusal; the rest is passed on untouched
	const response = (error as { response?: unknown } | null)?.response;

	if (!(response instanceof Response)) {
		return error;
	}

	// 2. A `VetchError` on a 2xx answer is a body the SDK could not decode, not a refusal: the status and the method
	//    only, since the `VetchError` itself carries the credentials
	if (response.ok) {
		return new Error(`Vonage: the ${response.status} answer to "${method}" could not be decoded`);
	}

	// 3. The SDK leaves the body of a refusal unread: JSON when it parses, the text otherwise, nothing when empty; a
	//    body that cannot be read any more is nothing too
	const text = await response.text().catch(() => '');
	let body: unknown = text.length === 0 ? undefined : text;

	if (text.length > 0) {
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}

	// 4. The status and the answer, for the caller to read; no request header goes into it
	return toProviderCallError({ provider: 'vonage', method, status: response.status, body, headers: response.headers });
};
