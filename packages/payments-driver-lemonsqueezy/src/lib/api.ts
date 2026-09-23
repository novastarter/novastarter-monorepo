import { type CallOptions, type CallResponse, type HttpApi, type HttpCallFetch, request } from '@novastarter/http';
import type { LsError } from '../types.js';

/**
 * The base URL of the Lemon Squeezy API.
 *
 * @defaultValue `https://api.lemonsqueezy.com/v1`
 */
export const API_URL = 'https://api.lemonsqueezy.com/v1';

/**
 * The hosts a full URL given to {@link LemonSqueezyApi.call} may point at, besides the configured API's own.
 *
 * @defaultValue `api.lemonsqueezy.com`
 * @internal
 */
export const LEMONSQUEEZY_CALL_HOSTS: readonly string[] = ['api.lemonsqueezy.com'];

/**
 * How long a request may take before it is abandoned, in milliseconds.
 *
 * @defaultValue 30 seconds.
 */
export const DEFAULT_TIMEOUT = 30_000;

/**
 * The longest request timeout a client accepts, in milliseconds: the largest 32-bit signed integer, which is as much
 * as a Node timer holds. `AbortSignal.timeout()` arms a 1 ms timer for anything above it, so a longer timeout would
 * abandon every request at once rather than never.
 *
 * @defaultValue 2^31 − 1, about 24.8 days.
 */
export const MAX_TIMEOUT = 2_147_483_647;

/**
 * The fetch the API client sends with: the platform's signature, narrowed to what is used.
 *
 * A fetch handed in has to honour `redirect: 'manual'` when given, and answer the headers: `call()` follows
 * redirects itself, by their `Location`, so the key never follows one to another host.
 */
export type ApiFetch = (
	url: string,
	init: {
		method: string;
		headers: Record<string, string>;
		body?: string | undefined;
		signal: AbortSignal;
		redirect?: 'manual' | undefined;
	},
) => Promise<{ status: number; ok: boolean; headers: Headers; text(): Promise<string> }>;

/**
 * Options of {@link LemonSqueezyApi}.
 */
export type LemonSqueezyApiConfig = {
	/** API key from Settings → API in the Lemon Squeezy dashboard. */
	apiKey: string;
	/** Another base URL — a stand-in of the API. */
	apiUrl?: string | undefined;
	/** Request timeout in milliseconds: a whole number from 1 to {@link MAX_TIMEOUT}. */
	timeout?: number | undefined;
	/** A fetch to send with instead of the platform's — tests hand in a fake. */
	fetch?: ApiFetch | undefined;
};

/**
 * A refusal by the Lemon Squeezy API: the status and the errors of its JSON:API error response.
 */
export class LemonSqueezyApiError extends Error {
	/**
	 * Create the error from a response.
	 *
	 * @param status - The HTTP status.
	 * @param errors - The `errors` of the response, when it was one.
	 */
	constructor(
		readonly status: number,
		readonly errors: LsError[],
	) {
		// 1. One line naming every error the API listed, so a log entry says what was refused without the body
		super(
			`Lemon Squeezy ${status}: ${errors.map((error) => error.detail ?? error.title ?? 'unknown error').join('; ') || 'request failed'}`,
		);

		this.name = 'LemonSqueezyApiError';
	}
}

/**
 * The errors of a JSON:API error response, when the body is one.
 *
 * @param text - The response body.
 * @returns The `errors`, or none for a body that is not JSON.
 */
const parseErrors = (text: string): LsError[] => {
	// 1. A gateway error page is not JSON; the status alone is reported then
	try {
		return (JSON.parse(text) as { errors?: LsError[] }).errors ?? [];
	} catch {
		return [];
	}
};

/**
 * A minimal client of the Lemon Squeezy JSON:API: authentication, the media types, error responses.
 *
 * Written against the REST API rather than `@lemonsqueezy/lemonsqueezy.js` because that SDK keeps its API key in
 * module state (`lemonSqueezySetup()`): two locations with two keys would share it.
 */
export class LemonSqueezyApi {
	/**
	 * The base URL without a trailing slash, so paths starting with one join cleanly.
	 *
	 * @internal
	 */
	private readonly apiUrl: string;

	/**
	 * The headers every request carries: the JSON:API media types and the bearer key.
	 *
	 * @internal
	 */
	private readonly headers: Record<string, string>;

	/**
	 * How long a request may take, in milliseconds.
	 *
	 * @internal
	 */
	private readonly timeout: number;

	/**
	 * The fetch requests are sent with.
	 *
	 * @internal
	 */
	private readonly fetch: ApiFetch;

	/**
	 * The API as {@link call} reaches it: the root without its `/v1`, Lemon Squeezy's host, the JSON:API media types
	 * and the bearer key, the client's timeout and fetch.
	 *
	 * @internal
	 */
	private readonly http: HttpApi;

	/**
	 * Create the client for one API key.
	 *
	 * @param config - Key, base URL, timeout or fetch.
	 * @throws RangeError for a timeout that is not a whole number from 1 to {@link MAX_TIMEOUT} — refused here, at
	 * registration, rather than on the first request.
	 */
	constructor(config: LemonSqueezyApiConfig) {
		// 1. Normalise the base URL once, so a configured trailing slash does not double up in every path
		this.apiUrl = (config.apiUrl ?? API_URL).replace(/\/$/, '');

		// 2. A timeout `AbortSignal.timeout()` cannot hold is refused now: a negative, fractional or `NaN` delay would
		//    throw on every request, `0` would abandon every request immediately, and one above the timer's bound
		//    would abandon every request after 1 ms — either way a misconfigured location would fail on first use
		//    with an error that does not name the cause
		this.timeout = config.timeout ?? DEFAULT_TIMEOUT;

		if (!(Number.isInteger(this.timeout) && this.timeout >= 1 && this.timeout <= MAX_TIMEOUT)) {
			throw new RangeError(
				`LemonSqueezyApi: "timeout" must be a whole number between 1 and ${MAX_TIMEOUT} ms, got ${config.timeout}`,
			);
		}

		// 3. JSON:API media types on both sides: the API refuses `application/json` bodies
		this.headers = {
			Accept: 'application/vnd.api+json',
			'Content-Type': 'application/vnd.api+json',
			Authorization: `Bearer ${config.apiKey}`,
		};

		// 4. The platform's fetch unless a test hands in its own, bound to the global object: `fetch` is a WebIDL
		//    operation on some runtimes and throws `TypeError: Illegal invocation` when called with another receiver,
		//    which is what `this.fetch(...)` would be; the cast narrows it to the signature used
		this.fetch = config.fetch ?? (globalThis.fetch.bind(globalThis) as unknown as ApiFetch);

		// 5. `call()` goes through the shared request: the root without its `/v1`, so the path names its version and a
		//    stand-in's own path prefix is kept; the client's fetch — a test's fake included — adapted to its
		//    signature, `redirect: 'manual'` passed on by name so the real fetch never follows a redirect with the key
		const fetcher: HttpCallFetch = async (input, { redirect, ...init }) =>
			(await this.fetch(input, {
				...(init as Omit<Parameters<ApiFetch>[1], 'redirect'>),
				redirect,
			})) as unknown as Response;

		this.http = {
			provider: 'lemonsqueezy',
			baseUrl: this.apiUrl.replace(/\/v1$/, ''),
			hosts: LEMONSQUEEZY_CALL_HOSTS,
			headers: this.headers,
			timeout: this.timeout,
			fetch: fetcher,
		};
	}

	/**
	 * Send a request and read its JSON.
	 *
	 * @typeParam T - The shape of the response document.
	 * @param method - `GET`, `POST`, `PATCH` or `DELETE`.
	 * @param path - The path under the base URL, with its query string.
	 * @param body - The JSON:API document to send, when there is one.
	 * @returns The parsed response; `undefined` for an empty one.
	 * @throws LemonSqueezyApiError for a non-2xx response.
	 * @throws `TimeoutError` (the `DOMException` of `AbortSignal.timeout()`) when the request outlives the timeout.
	 */
	async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
		// 1. The body is only set when given: a GET with a body is refused by some proxies; the signal abandons the
		//    request at the deadline, which the constructor checked the signal can hold
		const response = await this.fetch(`${this.apiUrl}${path}`, {
			method,
			headers: this.headers,
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			signal: AbortSignal.timeout(this.timeout),
		});

		const text = await response.text();

		// 2. A refusal carries JSON:API errors; anything else on a bad status is reported with the status alone
		if (!response.ok) {
			throw new LemonSqueezyApiError(response.status, parseErrors(text));
		}

		// 3. A 204 has no body; `undefined` rather than a parse error
		return (text ? JSON.parse(text) : undefined) as T;
	}

	/**
	 * Make a request of any endpoint of the API with the client's key, timeout and fetch, for the driver's `call()`.
	 *
	 * Paths are taken from the API's root rather than the `/v1` base of {@link request} — `GET /v1/stores` — the way
	 * Lemon Squeezy's reference writes them; a full URL has to be on {@link LEMONSQUEEZY_CALL_HOSTS}. The parameters
	 * of a `GET` or `DELETE` go in the query, JSON:API's brackets in the key (`'filter[store_id]': 1`), the others as
	 * the JSON:API document of the body. A `{name}` in the path is filled from the parameter of that name,
	 * URL-encoded, and that parameter is not sent again.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from Lemon Squeezy's API reference.
	 * @param method - The verb and the path from the API's root, or a full URL on Lemon Squeezy's host.
	 * @param params - The placeholders' values, and the query of a `GET` or `DELETE` or the body otherwise.
	 * @param options - A timeout over the client's, an abort signal, extra headers.
	 * @returns The status, the headers — names lower-cased — and the answer, parsed; `undefined` for an empty one.
	 * @throws ProviderCallError when the API answers with an error status — its status and `{ errors }` in `extensions`.
	 * @throws HitRateLimitError when the API answers 429.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, a `{name}` placeholder is left unfilled, or its URL is not
	 * on Lemon Squeezy's host.
	 * @example
	 * ```ts
	 * const { data } = await api.call('GET /v1/discounts', { 'filter[store_id]': 1 });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// 1. The shared request does it all: placeholders, the one host — so the key never travels elsewhere — the
		//    deadline, and an error status turned into the kit's error with the JSON:API `errors`
		return request<T>(this.http, method, params, options);
	}
}
