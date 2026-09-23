import { withTimeout } from '@novastarter/utils';
import { request as octokitRequest } from '@octokit/request';
import type { CallVerb } from './call.js';

/**
 * The URL a `call()` target points at: a path joined to the API's root, or a full URL, which has to be on one of the
 * provider's hosts.
 *
 * The host check is what keeps the location's credentials on the provider: a URL on any other host is refused before a
 * request carries them there.
 *
 * @param base - The API's root: `https://api.stripe.com`; a path in it — `https://api.cloudinary.com/v1_1/demo` — is
 * kept.
 * @param target - A path from that root, or a full URL.
 * @param allowedHosts - The hosts a full URL may point at, besides the base's own; `*.twilio.com` matches subdomains.
 * @returns The URL.
 * @throws Error when a `{name}` placeholder is left unfilled, or a full URL points at a host of another party.
 * @example
 * ```ts
 * resolveCallUrl('https://api.stripe.com', '/v1/customers', []); // https://api.stripe.com/v1/customers
 * resolveCallUrl('https://api.stripe.com', 'https://evil.example/x', ['files.stripe.com']); // throws
 * ```
 */
export const resolveCallUrl = (base: string, target: string, allowedHosts: readonly string[] = []): URL => {
	// 1. A placeholder nobody filled — neither a parameter nor the driver — is a mistake of the caller; sent, it would
	//    reach the provider as `%7Bname%7D`
	const unfilled = /\{([A-Za-z_][\w-]*)\}/.exec(target);

	if (unfilled) {
		throw new Error(`The call path needs a "${unfilled[1]}" parameter for its {${unfilled[1]}} placeholder`);
	}

	// 2. A path goes under the base: the base's own path kept in front, and a query the base carries — an API version —
	//    kept after the target's own
	const root = new URL(base);

	if (target.startsWith('/')) {
		const url = new URL(root.origin + root.pathname.replace(/\/+$/, '') + target);

		for (const [key, value] of root.searchParams.entries()) {
			if (!url.searchParams.has(key)) url.searchParams.append(key, value);
		}

		return url;
	}

	// 3. A full URL only on the base's host or one the driver allows — anywhere else would receive the credentials. The
	//    allowed hosts are read the way `URL` writes a host, lower-cased and in punycode, so `API.x.com` matches
	const url = new URL(target);

	const allowed = [root.host, ...allowedHosts.map(normalizeHost)].some((host) =>
		host.startsWith('*.') ? url.host.endsWith(host.slice(1)) : url.host === host,
	);

	// 4. HTTPS everywhere but on the base's own host, which may be a plain-HTTP stand-in in tests; the provider's real
	//    hosts are never reached without TLS
	const secure = url.host === root.host ? url.protocol === root.protocol : url.protocol === 'https:';

	if (!allowed || !secure) {
		throw new Error(`The call URL is not on a host of this provider: ${url.host}`);
	}

	return url;
};

/**
 * Write an allowed host the way `URL` writes one — lower-case, punycode — keeping a leading `*.` wildcard.
 *
 * @param host - The host, as a driver lists it.
 * @returns The normalized host.
 * @internal
 */
const normalizeHost = (host: string): string => {
	// 1. The wildcard is not part of a hostname, so it is set aside while `URL` normalizes the rest
	const wildcard = host.startsWith('*.');
	const normalized = new URL(`https://${wildcard ? host.slice(2) : host}`).host;

	return wildcard ? `*.${normalized}` : normalized;
};

/**
 * Turn one parameter value into the text a query, form or multipart field carries.
 *
 * A `Date` goes as its ISO 8601 string: it is an object, and `JSON.stringify` would wrap it in quotes that then land
 * on the wire. Any other object goes as JSON, a scalar as its plain string.
 *
 * @param item - The value, never `null` or `undefined`.
 * @returns The field's text.
 * @internal
 */
const toFieldValue = (item: unknown): string => {
	// 1. A date first, since it is an object too; then JSON for objects and plain text for scalars
	if (item instanceof Date) return item.toISOString();

	return typeof item === 'object' ? JSON.stringify(item) : String(item);
};

/**
 * Turn parameters into a query string, the way REST APIs read them: a list repeats its key, a `Date` goes as its ISO
 * string, any other object as JSON, `undefined` is left out.
 *
 * @param params - The parameters.
 * @returns The query, with its leading `?`, or an empty string when there is nothing to send.
 * @example
 * ```ts
 * toQueryString({ limit: 10, expand: ['a', 'b'] }); // '?limit=10&expand=a&expand=b'
 * ```
 */
export const toQueryString = (params: Record<string, unknown> = {}): string => {
	const search = new URLSearchParams();

	// 1. One pair per scalar, one per item of a list; `null` and `undefined` mean "not given"
	for (const [key, value] of Object.entries(params)) {
		for (const item of Array.isArray(value) ? value : [value]) {
			if (item === undefined || item === null) continue;

			search.append(key, toFieldValue(item));
		}
	}

	const query = search.toString();

	return query ? `?${query}` : '';
};

/**
 * What {@link httpCall} answers with: the provider's answer as it came, for the driver to judge.
 */
export interface HttpCallResponse {
	/** The HTTP status. */
	status: number;
	/** The response headers. */
	headers: Headers;
	/** The body: parsed JSON, else the text; `undefined` when empty. */
	body: unknown;
}

/**
 * The `fetch` {@link httpCall} makes its request with; the global one unless a driver hands its own — `undici`'s, a
 * fake in tests.
 */
export type HttpCallFetch = (
	url: string,
	init: {
		method: string;
		headers: Record<string, string>;
		body?: string | FormData | undefined;
		signal: AbortSignal;
		redirect: 'manual';
	},
) => Promise<Response>;

/**
 * What {@link httpCall} takes.
 */
export interface HttpCallRequest {
	/** The URL, from {@link resolveCallUrl}. */
	url: URL;
	/** The verb. */
	verb: CallVerb;
	/** The parameters: the query of a GET, HEAD or DELETE, the body otherwise. */
	params?: Record<string, unknown> | undefined;
	/**
	 * The driver's headers — the credentials — and the caller's on top. A `content-type` among them decides how the body
	 * goes: a form, multipart, JSON otherwise.
	 */
	headers?: Record<string, string> | undefined;
	/**
	 * How a body goes when no `content-type` says: `json` (the default; multipart as soon as a `Blob` is among the
	 * parameters) or `form`.
	 */
	bodyType?: 'json' | 'form' | undefined;
	/** The deadline, in milliseconds. */
	timeout: number;
	/** Abandons the request when aborted. */
	signal?: AbortSignal | undefined;
	/**
	 * The `fetch` to use; the global one unless given. It has to honour `redirect: 'manual'`: `httpCall` follows the
	 * redirects itself, so that credentials never follow one to another host.
	 */
	fetch?: HttpCallFetch | undefined;
}

/**
 * How many redirects {@link httpCall} follows before it gives up.
 *
 * @defaultValue 5
 */
export const MAX_CALL_REDIRECTS = 5;

/**
 * Make the HTTP request of a driver's `call()` on `@octokit/request`: the parameters as the query or the body, the
 * deadline, the answer parsed.
 *
 * It does not judge the status — every provider words its refusals its own way, so the driver turns a non-2xx answer
 * into its error, `toProviderCallError()` of `@novastarter/errors` for most. Nothing of the request — headers with
 * credentials included — goes into an error it throws.
 *
 * @param request - The URL, the verb, the parameters, the headers and the deadline.
 * @returns The status, the headers and the parsed body.
 * @throws TimeoutError when the deadline passes; the abort reason when the signal aborts; what `fetch` throws when the
 * provider cannot be reached.
 * @example
 * ```ts
 * const { status, body } = await httpCall({
 * 	url: resolveCallUrl('https://api.polar.sh', '/v1/products', []),
 * 	verb: 'GET',
 * 	params: { limit: 10 },
 * 	headers: { authorization: `Bearer ${token}` },
 * 	timeout: 30_000,
 * });
 * ```
 */
export const httpCall = async (request: HttpCallRequest): Promise<HttpCallResponse> => {
	// 1. The parameters go into the query of a GET, HEAD or DELETE and the body otherwise
	const params = request.params ?? {};
	const inQuery = request.verb === 'GET' || request.verb === 'HEAD' || request.verb === 'DELETE';
	const url = new URL(request.url);

	if (inQuery) {
		for (const [key, value] of new URLSearchParams(toQueryString(params)).entries()) {
			url.searchParams.append(key, value);
		}
	}

	// 2. Header names folded to lower case, so the driver's `Content-Type` and the default one are one header, not two;
	//    a neutral `accept` and `user-agent` replace the GitHub ones `@octokit/request` would send
	const headers: Record<string, string> = Object.fromEntries(
		Object.entries({ accept: 'application/json', 'user-agent': 'novastarter', ...request.headers }).map(
			([name, value]) => [name.toLowerCase(), value],
		),
	);

	const body = inQuery ? undefined : toBody(params, request.bodyType ?? 'json', headers);
	const fetcher: HttpCallFetch = request.fetch ?? globalFetch;

	// 3. `@octokit/request` makes the request, through a `fetch` that follows the redirects safely and reads the answer
	//    itself — Octokit's own reading turns big numbers into `BigInt`s, swallows a broken body and drops a repeated
	//    header; all of it under one deadline, the caller's signal aborting it too
	return withTimeout(
		async (signal) => {
			let answer: HttpCallResponse | undefined;
			let failure: { error: unknown } | undefined;

			try {
				await octokitRequest({
					method: request.verb,
					url: url.href,
					headers,
					...(body === undefined ? {} : { data: body }),
					request: {
						fetch: readingFetch(
							fetcher,
							url,
							(read) => {
								answer = read;
							},
							(error) => {
								failure = { error };
							},
						),
						signal,
						log: SILENT_LOG,
					},
				});
			} catch {
				// 4. A failure to reach the provider — a redirect refused, the abort reason — goes on as it was thrown,
				//    untouched by Octokit and never as its error, which quotes the request's headers
				throw failure ? failure.error : new Error('The request could not be sent');
			}

			// 5. The answer as read on the way, whatever its status: the caller judges it
			if (!answer) {
				throw new Error('The request ended without an answer');
			}

			return answer;
		},
		request.timeout,
		request.signal ? { signal: request.signal } : {},
	);
};

/**
 * The logger `@octokit/request` warns through — about GitHub's deprecation headers — kept silent: the providers of the
 * kit are not GitHub, and a warning on the console is not the application's log.
 *
 * @internal
 */
const SILENT_LOG = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * A `fetch` for `@octokit/request` that sends our request and reads the answer itself.
 *
 * The URL is the one built here, not Octokit's — it reads a path as a template, dropping `:send` of `messages:send` and a
 * trailing slash. The redirects are followed by hand, the way {@link follow} does, and a form body keeps no content type,
 * so `fetch` writes its boundary. The answer is read here — a broken body throws — and handed to `onAnswer`; Octokit
 * gets an empty `204`, so it has nothing to parse or judge. A failure is handed to `onFailure` and Octokit sees only a
 * plain error in its place: it marks an `AbortError` with `status = 500`, and that error is the caller's abort reason.
 *
 * @param fetcher - The `fetch` the requests go through.
 * @param target - The URL to request, as built by {@link httpCall}.
 * @param onAnswer - Receives the answer as read.
 * @param onFailure - Receives what the request or the reading threw.
 * @returns The adapted `fetch`.
 * @internal
 */
const readingFetch = (
	fetcher: HttpCallFetch,
	target: URL,
	onAnswer: (answer: HttpCallResponse) => void,
	onFailure: (error: unknown) => void,
) => {
	return async (_url: string, init: { method?: string; headers?: unknown; body?: unknown; signal?: AbortSignal }) => {
		// 1. Octokit's headers are a plain record; a form body keeps no content type, so `fetch` writes its boundary
		const headers = { ...(init.headers as Record<string, string>) };
		const body = init.body as string | FormData | undefined;

		if (body instanceof FormData) {
			delete headers['content-type'];
		}

		try {
			// 2. The request, its redirects, and the whole answer read — the headers kept as `Headers`, repeats included
			const response = await follow(fetcher, target, init.method ?? 'GET', headers, body, init.signal as AbortSignal);
			const text = await response.text();

			onAnswer({
				status: response.status,
				headers: response.headers,
				body: parseBody(text, response.headers.get('content-type')),
			});
		} catch (error) {
			// 3. What was thrown is kept for the caller, out of Octokit's reach
			onFailure(error);

			// eslint-disable-next-line preserve-caught-error -- Octokit must not reach the error: it marks an abort reason
			throw new Error('The request failed');
		}

		return new Response(null, { status: 204 });
	};
};

/**
 * The global `fetch`, adapted to {@link HttpCallFetch}: a body is only passed when there is one.
 *
 * @param input - The URL.
 * @param init - The request.
 * @returns The response.
 * @internal
 */
const globalFetch: HttpCallFetch = (input, { body, ...init }) => {
	// 1. `exactOptionalPropertyTypes` refuses an explicit `body: undefined`, so it is left out instead
	return fetch(input, body === undefined ? init : { ...init, body });
};

/**
 * Make a request and follow its redirects by hand, so the credentials stay on the host they were meant for.
 *
 * `fetch` would follow a redirect by itself and drop only `Authorization` on the way to another host; a key in a header
 * of the provider's own — `x-api-key`, `X-Postmark-Server-Token` — would go along. Here a redirect on the same origin
 * keeps every header, one to another origin keeps none but `accept`, must stay on TLS and may not carry a body, and a
 * a `303`, or a `301`/`302` of a `POST`, turns into a `GET` without a body, the way browsers do — except a `HEAD`,
 * which stays a `HEAD` on a `303` per fetch semantics.
 *
 * @param fetcher - The `fetch` to use.
 * @param start - The first URL.
 * @param verb - The first verb.
 * @param headers - The headers, credentials included.
 * @param body - The body, if any.
 * @param signal - Aborts every request of the chain.
 * @returns The first answer that is not a redirect, or the redirect itself when it names no `Location`.
 * @throws Error when the chain is longer than {@link MAX_CALL_REDIRECTS}, or another origin would get plain HTTP or the
 * body.
 * @internal
 */
const follow = async (
	fetcher: HttpCallFetch,
	start: URL,
	verb: string,
	headers: Record<string, string>,
	body: string | FormData | undefined,
	signal: AbortSignal,
): Promise<Response> => {
	let url = start;
	let method = verb;
	let sentHeaders = headers;
	let sentBody = body;

	// 1. One request per hop; an answer that is not a redirect ends the chain
	for (let hop = 0; hop <= MAX_CALL_REDIRECTS; hop++) {
		const response = await fetcher(url.href, {
			method,
			headers: sentHeaders,
			...(sentBody === undefined ? {} : { body: sentBody }),
			signal,
			redirect: 'manual',
		});

		const location = response.headers.get('location');

		if (response.status < 300 || response.status > 399 || !location) {
			return response;
		}

		// 2. The next hop: a `303`, or a `301`/`302` of a `POST`, becomes a `GET` without a body, the way browsers do —
		//    a `HEAD` stays a `HEAD` on a `303`, so a redirect does not smuggle a full GET body into a caller that asked
		//    for headers only
		const next = new URL(location, url);

		if (
			(response.status === 303 && method !== 'HEAD') ||
			((response.status === 301 || response.status === 302) && method === 'POST')
		) {
			method = 'GET';
			sentBody = undefined;
			delete sentHeaders['content-type'];
		}

		// 3. Another origin gets no credentials, is reached over TLS when the chain started on it, and never gets a body:
		//    what the caller sent was meant for the provider, not for wherever it points
		if (next.origin !== url.origin) {
			if (url.protocol === 'https:' && next.protocol !== 'https:') {
				throw new Error(`The call was redirected to another origin without TLS: ${next.host}`);
			}

			if (sentBody !== undefined) {
				throw new Error(`The call was redirected to another origin with its body: ${next.host}`);
			}

			sentHeaders = { accept: headers['accept'] ?? 'application/json' };
		}

		// 4. The redirect's own body is dropped, so the connection is released before the next request
		await response.body?.cancel();
		url = next;
	}

	throw new Error(`The call was redirected more than ${MAX_CALL_REDIRECTS} times`);
};

/**
 * The body of an answer: JSON when it parses and its type is JSON, missing, or it is an object or a list; the text
 * otherwise; nothing when empty.
 *
 * @param text - The body as text.
 * @param type - The answer's `content-type`, when it has one.
 * @returns The parsed body.
 * @internal
 */
const parseBody = (text: string, type: string | null): unknown => {
	// 1. An empty body — a 204 — is nothing
	if (text.length === 0) return undefined;

	// 2. JSON when the answer says so, says nothing, or is an object or a list whatever its type — providers label JSON
	//    as text now and then; a bare scalar under a text type — `"0012"` as text/plain — stays the text it is
	const media = type?.split(';')[0]?.trim().toLowerCase();
	const json = !media || media === 'application/json' || media.endsWith('+json') || /^\s*[{[]/.test(text);

	if (!json) {
		return text;
	}

	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
};

/**
 * Build the body of a request, and set its content type where `fetch` does not.
 *
 * @param params - The defined and undefined parameters.
 * @param bodyType - JSON or a form.
 * @param headers - The headers, completed with the content type.
 * @returns The body.
 * @internal
 */
const toBody = (
	params: Record<string, unknown>,
	bodyType: 'json' | 'form',
	headers: Record<string, string>,
): string | FormData => {
	const entries = Object.entries(params).filter(([, value]) => value !== undefined);
	const type = headers['content-type']?.split(';')[0]?.trim().toLowerCase();

	// 1. A file among the parameters — or in a list of them — or a caller asking for `multipart/form-data` makes it
	//    multipart; `fetch` sets the type with its boundary, so a type set before is dropped. A list repeats its field,
	//    `null` is left out as in a query
	const isFile = (value: unknown): boolean => value instanceof Blob;
	const hasFile = entries.some(([, value]) => isFile(value) || (Array.isArray(value) && value.some(isFile)));

	if (hasFile || type === 'multipart/form-data') {
		const form = new FormData();

		delete headers['content-type'];

		for (const [key, value] of entries) {
			for (const item of Array.isArray(value) ? value : [value]) {
				if (item === null || item === undefined) continue;

				if (item instanceof Blob) {
					form.append(key, item, item instanceof File ? item.name : key);
				} else {
					form.append(key, toFieldValue(item));
				}
			}
		}

		return form;
	}

	// 2. A form when the driver's API wants one or the caller asked for it with the content type
	if (type === 'application/x-www-form-urlencoded' || (type === undefined && bodyType === 'form')) {
		headers['content-type'] ??= 'application/x-www-form-urlencoded';

		return toQueryString(Object.fromEntries(entries)).slice(1);
	}

	// 3. JSON otherwise, under the caller's own type when given — `application/vnd.api+json` stays
	headers['content-type'] ??= 'application/json';

	return JSON.stringify(Object.fromEntries(entries));
};
