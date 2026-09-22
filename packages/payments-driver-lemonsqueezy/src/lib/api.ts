import type { LsError } from '../types.js';

/**
 * The base URL of the Lemon Squeezy API.
 *
 * @defaultValue `https://api.lemonsqueezy.com/v1`
 */
export const API_URL = 'https://api.lemonsqueezy.com/v1';

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
 */
export type ApiFetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body?: string | undefined; signal: AbortSignal },
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

/**
 * Options of {@link LemonSqueezyApi}.
 */
export type LemonSqueezyApiConfig = {
	/** API key from Settings → API in the Lemon Squeezy dashboard. */
	apiKey: string;
	/** Another base URL — a stand-in of the API. */
	apiUrl?: string | undefined;
	/** Request timeout in milliseconds: a whole number from `0` to {@link MAX_TIMEOUT}. */
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
	 * Create the client for one API key.
	 *
	 * @param config - Key, base URL, timeout or fetch.
	 * @throws RangeError for a timeout that is not a whole number from `0` to {@link MAX_TIMEOUT} — refused here, at
	 * registration, rather than on the first request.
	 */
	constructor(config: LemonSqueezyApiConfig) {
		// 1. Normalise the base URL once, so a configured trailing slash does not double up in every path
		this.apiUrl = (config.apiUrl ?? API_URL).replace(/\/$/, '');

		// 2. A timeout `AbortSignal.timeout()` cannot hold is refused now: a negative, fractional or `NaN` delay would
		//    throw on every request, and one above the timer's bound would abandon every request after 1 ms — either
		//    way a misconfigured location would fail on first use with an error that does not name the cause
		this.timeout = config.timeout ?? DEFAULT_TIMEOUT;

		if (!(Number.isInteger(this.timeout) && this.timeout >= 0 && this.timeout <= MAX_TIMEOUT)) {
			throw new RangeError(
				`LemonSqueezyApi: "timeout" must be a whole number between 0 and ${MAX_TIMEOUT} ms, got ${config.timeout}`,
			);
		}

		// 3. JSON:API media types on both sides: the API refuses `application/json` bodies
		this.headers = {
			Accept: 'application/vnd.api+json',
			'Content-Type': 'application/vnd.api+json',
			Authorization: `Bearer ${config.apiKey}`,
		};

		// 4. The platform's fetch unless a test hands in its own; the cast narrows it to the signature used
		this.fetch = config.fetch ?? (globalThis.fetch as unknown as ApiFetch);
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
}
