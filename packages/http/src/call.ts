/**
 * The HTTP verbs a `call()` accepts in its `method`.
 *
 * @defaultValue `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`
 */
export const CALL_VERBS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * One of {@link CALL_VERBS}.
 */
export type CallVerb = (typeof CALL_VERBS)[number];

/**
 * Per-call options every driver's `call()` takes as its third argument.
 */
export interface CallOptions {
	/** How long the request may take, in milliseconds; the location's own timeout unless given. */
	timeout?: number | undefined;
	/** Abandons the request when aborted, alongside the timeout. */
	signal?: AbortSignal | undefined;
	/**
	 * Extra headers — an idempotency key, an API version — added over the driver's own, a name the driver sets too
	 * replaced. A `content-type` also picks how the body goes: a form for `application/x-www-form-urlencoded`,
	 * multipart for `multipart/form-data`, JSON otherwise.
	 */
	headers?: Record<string, string> | undefined;
}

/**
 * A `call()` method taken apart: its verb and what follows it.
 */
export interface ParsedCallMethod {
	/** The verb, upper-cased. */
	verb: CallVerb;
	/** The path from the API's root, or a full URL, with the `{name}` placeholders the parameters fill filled in. */
	target: string;
	/** The parameters left once the placeholders took theirs: the query or the body of the request. */
	params: Record<string, unknown>;
}

/**
 * Take a REST `call()` method apart — `'GET /v1/customers'` → `{ verb: 'GET', target: '/v1/customers' }` — and fill
 * its `{name}` placeholders from the parameters, the way Octokit does.
 *
 * The verb is case-insensitive; the target is a path from the API's root (`/v1/customers`) or a full URL
 * (`https://files.stripe.com/v1/files`), which `resolveCallUrl()` checks against the
 * provider's hosts. A `{name}` with a parameter of that name is replaced by the parameter, URL-encoded, and the
 * parameter taken out of the rest; a `{name}` without one stays for the driver to fill — `{bucket}`, `{AccountSid}` —
 * and `resolveCallUrl()` refuses one nobody filled.
 *
 * @param method - The verb and the path or URL, separated by whitespace.
 * @param params - The parameters of the call; the ones a placeholder takes are removed from the result's.
 * @returns The verb, the target and the parameters left.
 * @throws Error when the verb is not one of {@link CALL_VERBS}, the target is neither a path nor a URL, or a
 * placeholder's parameter is not a scalar, or is empty, `.` or `..`.
 * @example
 * ```ts
 * parseCallMethod('get /repos/{owner}/{repo}/issues', { owner: 'acme', repo: 'web', state: 'open' });
 * // { verb: 'GET', target: '/repos/acme/web/issues', params: { state: 'open' } }
 * ```
 */
export const parseCallMethod = (method: string, params: Record<string, unknown> = {}): ParsedCallMethod => {
	// 1. Two parts: a verb and a target, whatever whitespace between them
	const match = /^\s*([A-Za-z]+)\s+(\S+)\s*$/.exec(method);
	const verb = match?.[1]?.toUpperCase();
	const raw = match?.[2];

	if (!verb || !raw || !(CALL_VERBS as readonly string[]).includes(verb)) {
		throw new Error(`The call method "${method}" is not "<${CALL_VERBS.join('|')}> /path"`);
	}

	// 2. A path from the root or a full URL; anything else — `customers`, `//host` — is ambiguous
	if (!/^\/(?!\/)/.test(raw) && !/^https?:\/\//i.test(raw)) {
		throw new Error(`The call target "${raw}" is neither a path starting with "/" nor an http(s) URL`);
	}

	// 3. Each placeholder with a parameter of its own name takes it — looked up on the parameters themselves, so a
	//    `{constructor}` is not filled from the prototype — encoded, so a `/` or a `?` in a value cannot reshape the
	//    path; the parameter is then not sent again in the query or the body. The same placeholder twice takes the same
	//    value twice
	const rest: Record<string, unknown> = { ...params };

	const target = raw.replace(/\{([A-Za-z_][\w-]*)\}/g, (placeholder, name: string) => {
		if (!Object.hasOwn(params, name) || params[name] === undefined || params[name] === null) {
			return placeholder;
		}

		delete rest[name];

		return encodeSegment(name, params[name]);
	});

	return { verb: verb as CallVerb, target, params: rest };
};

/**
 * Encode one parameter for a path placeholder.
 *
 * @param name - The placeholder's name, for the message.
 * @param value - The parameter.
 * @returns The value, URL-encoded.
 * @throws Error for a value that is not a string, a number, a bigint or a boolean, and for an empty, `.` or `..` one —
 * `encodeURIComponent` keeps dots, and a URL collapses a dot segment, so `DELETE /files/{id}` with `..` would reach the
 * parent path, and an empty one the collection.
 * @internal
 */
const encodeSegment = (name: string, value: unknown): string => {
	// 1. Only scalars have one place in a path; a list or an object is a mistake of the caller
	if (!['string', 'number', 'bigint', 'boolean'].includes(typeof value)) {
		throw new Error(`The call parameter "${name}" fills a path placeholder and must be a string or a number`);
	}

	// 2. A value that would move the request to another path is refused rather than sent somewhere unintended
	const text = String(value);

	if (text === '' || text === '.' || text === '..') {
		throw new Error(`The call parameter "${name}" fills a path placeholder and cannot be empty, "." or ".."`);
	}

	return encodeURIComponent(text);
};

/**
 * What every `call()` answers with: the HTTP status, the headers and the body — the way Octokit answers.
 *
 * @typeParam T - What the provider's body is.
 */
export interface CallResponse<T = unknown> {
	/** The HTTP status. */
	status: number;
	/** The response headers, names lower-cased: `link`, `x-ratelimit-remaining`, `request-id`. */
	headers: Record<string, string>;
	/** The body: parsed JSON, else text; `undefined` for an empty one. */
	data: T;
}

/**
 * Response headers in the shapes transports hand them in: a `Headers`, or a record of strings or lists of strings.
 */
export type HeadersLike =
	| { forEach(callback: (value: string, name: string) => void): void }
	| Record<string, string | string[] | number | undefined>;

/**
 * Turn response headers into a plain record with lower-case names; a list becomes one comma-joined value, and so does a
 * header a `Headers` yields twice.
 *
 * @param headers - The headers: a `Headers`, a record, or nothing.
 * @returns The record.
 * @example
 * ```ts
 * toHeaderRecord(new Headers({ 'X-RateLimit-Remaining': '9' })); // { 'x-ratelimit-remaining': '9' }
 * ```
 */
export const toHeaderRecord = (headers: HeadersLike | undefined): Record<string, string> => {
	const record: Record<string, string> = {};

	// 1. A `Headers` walks itself — a header it yields twice, `set-cookie`, is joined as a record's list is; a record is
	//    read key by key, `undefined` values left out
	if (!headers) return record;

	if (typeof headers.forEach === 'function') {
		(headers as { forEach(callback: (value: string, name: string) => void): void }).forEach((value, name) => {
			const key = name.toLowerCase();

			record[key] = record[key] === undefined ? value : `${record[key]}, ${value}`;
		});

		return record;
	}

	for (const [name, value] of Object.entries(headers as Record<string, string | string[] | number | undefined>)) {
		if (value === undefined) continue;

		record[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
	}

	return record;
};
