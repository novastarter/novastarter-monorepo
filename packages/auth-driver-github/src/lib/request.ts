import { AuthProviderFailedError } from '@novastarter/auth';
import type { HttpCallFetch } from '@novastarter/http';
import { toErrorMessage, tryParseJSON, withTimeout } from '@novastarter/utils';
import { PROVIDER } from './constants.js';

/**
 * The fetch the driver sends its requests with: the platform's signature, narrowed to what is used.
 */
export type AuthFetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body?: string | undefined; signal: AbortSignal },
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

/**
 * How a request is sent: the fetch and the deadline each request gets.
 */
export interface RequestContext {
	/** The fetch to send with. */
	fetch: AuthFetch;
	/** How long one request may take, in milliseconds. */
	timeout: number;
}

/**
 * What a request is: the method, the headers and the body, without the signal the deadline adds.
 */
export interface RequestInit {
	/** `GET` or `POST`. */
	method: 'GET' | 'POST';
	/** The headers to send. */
	headers: Record<string, string>;
	/** The encoded body, for a `POST`. */
	body?: string | undefined;
}

/**
 * A response read to the end.
 */
export interface ProviderResponse {
	/** The HTTP status. */
	status: number;
	/** Whether the status is 2xx. */
	ok: boolean;
	/** The parsed JSON body; `undefined` for a body that is empty or not JSON. */
	body: unknown;
	/** The response headers; empty when the answer carries none, as a narrow fake's does not. */
	headers: Headers;
}

/**
 * Send a request to GitHub and read its JSON, within the context's deadline.
 *
 * A status is never an error here: what a refusal means differs by endpoint, so the caller reads it. Only a request
 * that got no answer — the network, the deadline — throws.
 *
 * @param context - The fetch and the deadline.
 * @param url - Where to send.
 * @param init - The method, the headers and the body.
 * @returns The status, the headers and the parsed body.
 * @throws AuthProviderFailedError when the request fails or outlives the deadline, with the original as the cause.
 * @example
 * ```ts
 * const response = await request(context, TOKEN_URL, { method: 'POST', headers, body });
 * ```
 */
export const request = async (context: RequestContext, url: string, init: RequestInit): Promise<ProviderResponse> => {
	// The deadline covers the body too, so a response that stalls halfway cannot hold the sign-in; the signal really
	// aborts the fetch rather than leaving it running after the caller gave up
	try {
		return await withTimeout(async (signal) => {
			// A body that is not JSON, such as a gateway's HTML page, reads as none, and the status says the rest
			const response = await context.fetch(url, { ...init, signal });
			const text = await response.text();

			// A refusal may name a rate limit in the headers, which the caller must not miss
			const { headers } = response as { headers?: unknown };

			return {
				status: response.status,
				ok: response.ok,
				body: tryParseJSON(text),
				headers: headers instanceof Headers ? headers : new Headers(),
			};
		}, context.timeout);
	} catch (error) {
		// No answer at all is still the provider failing, reported the same way as a refusal
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: `the request to ${url} failed: ${toErrorMessage(error)}` },
			{ cause: error },
		);
	}
};

/**
 * Adapt the driver's {@link AuthFetch} to the fetch `request()` of `@novastarter/http` sends a `call()` with.
 *
 * `httpCall()` follows redirects itself and asks the fetch for `redirect: 'manual'`, so credentials never follow a
 * redirect to another host; it may also send a multipart body. {@link AuthFetch} names neither, so that a narrowly
 * typed custom fetch still fits it — the request is passed on whole anyway, and a custom fetch must honour `redirect`
 * the way the platform's does. A fake that answers without headers gets empty ones, which `httpCall()` reads for a
 * redirect's `Location` and a 429's `Retry-After`.
 *
 * @param fetcher - The driver's fetch: the platform's, or one a test hands in.
 * @returns The fetch for `httpCall()`.
 * @example
 * ```ts
 * await httpCall({ url, verb: 'GET', timeout: 10_000, fetch: toHttpCallFetch(context.fetch) });
 * ```
 */
export const toHttpCallFetch =
	(fetcher: AuthFetch): HttpCallFetch =>
	async (url, init) => {
		// The type hides `redirect: 'manual'` and a `FormData` body, but the request passes on whole
		const response = await fetcher(url, init as unknown as Parameters<AuthFetch>[1]);

		// A fake's answer is completed with what `httpCall()` reads of it
		if (response instanceof Response) return response;

		const { headers } = response as { headers?: unknown };

		return {
			status: response.status,
			ok: response.ok,
			headers: headers instanceof Headers ? headers : new Headers(),
			body: null,
			text: () => response.text(),
		} as unknown as Response;
	};
