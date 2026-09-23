import { toProviderCallError } from '@novastarter/errors';
import { type CallOptions, type CallResponse, parseCallMethod, toHeaderRecord } from './call.js';
import { httpCall, type HttpCallFetch, type HttpCallResponse } from './http-call.js';

/**
 * How long a request may take when neither the call nor the API names a timeout, in milliseconds.
 *
 * @defaultValue 30 000 ms.
 */
export const DEFAULT_REQUEST_TIMEOUT = 30_000;

/**
 * What {@link http} takes besides the method and the parameters.
 */
export interface HttpOptions extends CallOptions {
	/** How a body goes when the `content-type` header does not say: JSON (the default) or a form. */
	bodyType?: 'json' | 'form' | undefined;
	/** The `fetch` to use — a fake in tests; the global one unless given. It must honour `redirect: 'manual'`. */
	fetch?: HttpCallFetch | undefined;
	/** Who errors name as the provider; the URL's host unless given. */
	provider?: string | undefined;
	/**
	 * How errors name the call; the verb with the URL's origin and path unless given — never its query, which may carry
	 * a key.
	 */
	label?: string | undefined;
	/** The provider's own refusals, judged before the kit's mapping: an error to throw, or `undefined`. */
	refuse?: ((response: HttpCallResponse, label: string) => Error | undefined) | undefined;
}

/**
 * Make a request of any URL from anywhere in the application, on `@octokit/request`.
 *
 * `method` is the verb and a full URL — `'GET https://api.github.com/repos/{owner}/{repo}'` — its `{name}` filled from
 * the parameter of that name; the other parameters are the query of a `GET`, `HEAD` or `DELETE` and the body otherwise:
 * JSON, a form or multipart as the `content-type` header and the files among them say. Redirects are followed by hand —
 * to another origin without the headers; one that would carry the body there, or leave TLS, is refused — and the timeout covers every hop and the reading of the answer.
 *
 * @typeParam T - What the body is.
 * @param method - The verb and the full URL.
 * @param params - The placeholders' values, and the query or body.
 * @param options - Headers, a timeout — 30 s unless given — an abort signal.
 * @returns The status, the headers — names lower-cased — and the body: parsed JSON, else text, `undefined` when empty.
 * @throws ProviderCallError for an error status, with the status and the answer in `extensions`.
 * @throws HitRateLimitError for a 429, reset at `Retry-After`.
 * @throws TimeoutError when the request outlives its timeout; the abort reason when the signal aborts.
 * @throws Error when the method is malformed, its target is not a full URL, or a placeholder is left unfilled.
 * @example
 * ```ts
 * const { data } = await http('GET https://api.github.com/repos/{owner}/{repo}', { owner: 'acme', repo: 'web' });
 *
 * await http('POST https://api.polar.sh/v1/refunds', { order_id: 'o1' }, {
 * 	headers: { authorization: `Bearer ${token}` },
 * });
 * ```
 */
export const http = async <T = unknown>(
	method: string,
	params: Record<string, unknown> = {},
	options: HttpOptions = {},
): Promise<CallResponse<T>> => {
	// 1. The verb and a full URL, its placeholders filled; a path has no host to go to, and one left unfilled is refused
	const parsed = parseCallMethod(method, params);

	if (!/^https?:\/\//i.test(parsed.target)) {
		throw new Error(`http() needs a full URL, not "${parsed.target}"`);
	}

	const unfilled = /\{([A-Za-z_][\w-]*)\}/.exec(parsed.target);

	if (unfilled) {
		throw new Error(`The request needs a "${unfilled[1]}" parameter for its {${unfilled[1]}} placeholder`);
	}

	const url = new URL(parsed.target);
	const label = options.label ?? `${parsed.verb} ${url.origin}${url.pathname}`;

	// 2. The request itself, its redirects followed safely and the whole of it under one deadline
	const response = await httpCall({
		url,
		verb: parsed.verb,
		params: parsed.params,
		headers: options.headers,
		bodyType: options.bodyType,
		timeout: options.timeout ?? DEFAULT_REQUEST_TIMEOUT,
		signal: options.signal,
		fetch: options.fetch,
	});

	// 3. The provider's own refusals first, then the kit's mapping of any other error status
	const refused = options.refuse?.(response, label);

	if (refused) {
		throw refused;
	}

	if (response.status < 200 || response.status >= 300) {
		throw toProviderCallError({
			provider: options.provider ?? url.host,
			method: label,
			status: response.status,
			body: response.body,
			headers: response.headers,
		});
	}

	return { status: response.status, headers: toHeaderRecord(response.headers), data: response.body as T };
};
