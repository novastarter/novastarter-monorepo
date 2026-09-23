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
	 * replaced. A `content-type` also picks how the body goes where the driver builds it: a form for
	 * `application/x-www-form-urlencoded`, multipart for `multipart/form-data`, the `body` parameter as it is for another
	 * non-JSON type (XML, plain text), JSON otherwise.
	 */
	headers?: Record<string, string> | undefined;
	/**
	 * Where the parameters go: the query of a `GET`, `HEAD` or `DELETE` and the body of the other verbs unless given —
	 * `body` for an API that reads a `DELETE` body, `query` for one that wants a `POST` with a query only.
	 */
	paramsIn?: 'query' | 'body' | undefined;
}

/**
 * Where a request's parameters go, when the caller does not say: the query of a `GET`, `HEAD` or `DELETE`, the body
 * of the other verbs.
 *
 * @param verb - The verb.
 * @param paramsIn - The caller's choice, when made.
 * @returns `query` or `body`.
 * @example
 * ```ts
 * callParamsIn('DELETE'); // 'query'
 * callParamsIn('DELETE', 'body'); // 'body'
 * ```
 */
export const callParamsIn = (verb: CallVerb, paramsIn?: 'query' | 'body'): 'query' | 'body' => {
	// 1. The caller knows the API; without a word, the verbs that carry no body by convention use the query
	if (paramsIn) return paramsIn;

	return verb === 'GET' || verb === 'HEAD' || verb === 'DELETE' ? 'query' : 'body';
};

/**
 * A `call()` method taken apart: its verb and what follows it.
 */
export interface ParsedCallMethod {
	/** The verb, upper-cased. */
	verb: CallVerb;
	/** The path from the API's root, or a full URL. */
	target: string;
}

/**
 * Take a REST `call()` method apart: `'GET /v1/customers'` → `{ verb: 'GET', target: '/v1/customers' }`.
 *
 * The verb is case-insensitive; the target is a path from the API's root (`/v1/customers`) or a full URL
 * (`https://files.stripe.com/v1/files`), which `resolveCallUrl()` of `@novastarter/utils/node` checks against the
 * provider's hosts.
 *
 * @param method - The verb and the path or URL, separated by whitespace.
 * @returns The verb and the target.
 * @throws Error when the verb is not one of {@link CALL_VERBS}, or the target is neither a path nor a URL.
 * @example
 * ```ts
 * parseCallMethod('post /v1/refunds'); // { verb: 'POST', target: '/v1/refunds' }
 * ```
 */
export const parseCallMethod = (method: string): ParsedCallMethod => {
	// 1. Two parts: a verb and a target, whatever whitespace between them
	const match = /^\s*([A-Za-z]+)\s+(\S+)\s*$/.exec(method);
	const verb = match?.[1]?.toUpperCase();
	const target = match?.[2];

	if (!verb || !target || !(CALL_VERBS as readonly string[]).includes(verb)) {
		throw new Error(`The call method "${method}" is not "<${CALL_VERBS.join('|')}> /path"`);
	}

	// 2. A path from the root or a full URL; anything else — `customers`, `//host` — is ambiguous
	if (!/^\/(?!\/)/.test(target) && !/^https?:\/\//i.test(target)) {
		throw new Error(`The call target "${target}" is neither a path starting with "/" nor an http(s) URL`);
	}

	return { verb: verb as CallVerb, target };
};
