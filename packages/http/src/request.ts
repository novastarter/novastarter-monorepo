import { withTimeout } from '@novastarter/utils';
import { type CallOptions, type CallResponse, parseCallMethod } from './call.js';
import { type HttpCallFetch, type HttpCallResponse, resolveCallUrl } from './http-call.js';
import { DEFAULT_REQUEST_TIMEOUT, http } from './http.js';

/**
 * A provider's API as a driver describes it once — its root, its hosts, its credentials — for {@link request}.
 */
export interface HttpApi {
	/** The provider's name, as errors name it: `polar`, `resend`. */
	provider: string;
	/** The API's root: `https://api.polar.sh`; a path in it is kept in front of every call's path. */
	baseUrl: string;
	/** The hosts a full URL may point at besides the root's own; `*.twilio.com` matches subdomains. */
	hosts?: readonly string[] | undefined;
	/**
	 * The credential headers. A function is for a token fetched per call — a service account's access token — and runs
	 * under the call's deadline, after the host check, so a refused URL never costs a token.
	 */
	headers?: Record<string, string> | ((signal: AbortSignal) => Promise<Record<string, string>>) | undefined;
	/** The driver's own placeholders, filled after the caller's parameters had their turn: `{ bucket: 'uploads' }`. */
	placeholders?: Record<string, string> | undefined;
	/** A query every request carries — a signature — kept out of every error and never shown to the caller. */
	query?: Record<string, string> | undefined;
	/** Every call's timeout, in milliseconds, unless the call names one; {@link DEFAULT_REQUEST_TIMEOUT} unless given. */
	timeout?: number | undefined;
	/** How a body goes when the caller's `content-type` does not say: JSON (the default) or a form. */
	bodyType?: 'json' | 'form' | undefined;
	/** The `fetch` — `undici`'s, a fake in tests; the global one unless given. It must honour `redirect: 'manual'`. */
	fetch?: HttpCallFetch | undefined;
	/**
	 * The provider's own refusals, looked at before the generic mapping: a rate limit GitHub answers with a 403, the
	 * 420 of Cloudinary. Answers an error to throw, or `undefined` to leave the response to the generic mapping.
	 */
	refuse?: ((response: HttpCallResponse, method: string) => Error | undefined) | undefined;
}

/**
 * Make a request of a provider's own API: the whole of a driver's `call()`.
 *
 * The method is taken apart and its `{name}` placeholders filled — from the caller's parameters, then from the
 * driver's own — the URL checked against the provider's hosts, the credentials added, the request made under one
 * deadline with its redirects followed safely, and the answer judged: a 2xx is the `{ status, headers, data }` every
 * `call()` answers with, anything else the kit's error. No credential ever goes into an error.
 *
 * @typeParam T - What the provider's body is; the caller knows it from the provider's documentation.
 * @param api - The provider's API, as the driver describes it.
 * @param method - The verb and path — `'GET /v1/products'` — or a full URL on the provider's hosts.
 * @param params - The query of a `GET`, `HEAD` or `DELETE`, the body otherwise; a parameter a `{name}` takes is not
 * sent again.
 * @param options - A timeout over the API's, an abort signal, extra headers over the credentials.
 * @returns The status, the headers — names lower-cased — and the body: parsed JSON, else text, `undefined` when empty.
 * @throws ProviderCallError for an error status, with the provider's status and answer in `extensions`.
 * @throws HitRateLimitError for a 429, reset at `Retry-After`.
 * @throws TimeoutError when the call outlives its timeout; the abort reason when the signal aborts.
 * @throws Error when the method is malformed, a placeholder is left unfilled, a full URL is on another host, a
 * parameter takes the name of the driver's secret query, or the credentials could not be had.
 * @example
 * ```ts
 * class PaymentsDriverPolar {
 * 	private readonly api: HttpApi = {
 * 		provider: 'polar',
 * 		baseUrl: 'https://api.polar.sh',
 * 		headers: { authorization: `Bearer ${token}` },
 * 	};
 *
 * 	async call<T>(method: string, params?: Record<string, unknown>, options?: CallOptions) {
 * 		return request<T>(this.api, method, params, options);
 * 	}
 * }
 * ```
 */
export const request = async <T = unknown>(
	api: HttpApi,
	method: string,
	params: Record<string, unknown> = {},
	options: CallOptions = {},
): Promise<CallResponse<T>> => {
	// 1. The method, the caller's placeholders, then the driver's; the URL checked before any credential is touched, and
	//    the driver's secret query added, a parameter of the same name refused
	const parsed = parseCallMethod(method, params);
	let target = parsed.target;

	for (const [name, value] of Object.entries(api.placeholders ?? {})) {
		target = target.replaceAll(`{${name}}`, encodeURIComponent(value));
	}

	const url = resolveCallUrl(api.baseUrl, target, api.hosts ?? []);

	for (const [name, value] of Object.entries(api.query ?? {})) {
		if (Object.hasOwn(parsed.params, name)) {
			throw new Error(`The call parameter "${name}" is reserved by the ${api.provider} driver`);
		}

		url.searchParams.set(name, value);
	}

	// 2. The credentials — fetched under the same deadline when they are a token — and the caller's headers on top;
	//    the request itself under that deadline too, so the timeout covers every step
	const timeout = options.timeout ?? api.timeout ?? DEFAULT_REQUEST_TIMEOUT;

	return withTimeout(
		async (signal) => {
			const credentials = typeof api.headers === 'function' ? await credentialsOf(api, signal) : (api.headers ?? {});

			// 3. The request through `http()`, named in errors by the method as the caller wrote it — the URL may carry
			//    the secret query — and judged by the driver's own refusals first
			return http<T>(`${parsed.verb} ${url.href}`, parsed.params, {
				headers: { ...credentials, ...options.headers },
				bodyType: api.bodyType,
				timeout,
				signal,
				fetch: api.fetch,
				provider: api.provider,
				label: method,
				refuse: api.refuse,
			});
		},
		timeout,
		options.signal ? { signal: options.signal } : {},
	);
};

/**
 * Fetch the credential headers of an API whose `headers` is a function, with a failure that names no detail.
 *
 * A token endpoint's error — a service account's refusal, a network failure — may carry the request that asked for
 * the token, so it never reaches the caller as it is: the caller learns the provider and the kind of failure only. An
 * abort — the deadline, the caller's signal — goes on as it is.
 *
 * @param api - The API, with a function for `headers`.
 * @param signal - Aborted at the deadline or by the caller.
 * @returns The headers.
 * @throws Error naming the provider when the credentials could not be had; the abort reason once the signal aborted.
 * @internal
 */
const credentialsOf = async (api: HttpApi, signal: AbortSignal): Promise<Record<string, string>> => {
	try {
		// 1. The driver's own way to a token
		return await (api.headers as (signal: AbortSignal) => Promise<Record<string, string>>)(signal);
	} catch (error) {
		// 2. An abort is the deadline's or the caller's, and says nothing secret; anything else is replaced
		if (signal.aborted) {
			throw error;
		}

		const kind = error instanceof Error ? error.name : typeof error;

		// eslint-disable-next-line preserve-caught-error -- the token endpoint's error may carry the credentials' request
		throw new Error(`${api.provider}: the credentials for the call could not be had (${kind})`);
	}
};
