import { AuthProviderFailedError } from '@novastarter/auth';
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
 * @returns The status and the parsed body.
 * @throws AuthProviderFailedError when the request fails or outlives the deadline, with the original as the cause.
 * @example
 * ```ts
 * const response = await request(context, TOKEN_URL, { method: 'POST', headers, body });
 * ```
 */
export const request = async (context: RequestContext, url: string, init: RequestInit): Promise<ProviderResponse> => {
	// 1. The deadline covers the body too, so a response that stalls halfway cannot hold the sign-in; the signal
	//    really aborts the fetch rather than leaving it running after the caller gave up
	try {
		return await withTimeout(async (signal) => {
			// 1. A body that is not JSON — a gateway's HTML page — reads as none, and the status says the rest
			const response = await context.fetch(url, { ...init, signal });
			const text = await response.text();

			return { status: response.status, ok: response.ok, body: tryParseJSON(text) };
		}, context.timeout);
	} catch (error) {
		// 2. No answer at all is still the provider failing, reported the same way as a refusal
		throw new AuthProviderFailedError(
			{ provider: PROVIDER, reason: `the request to ${url} failed: ${toErrorMessage(error)}` },
			{ cause: error },
		);
	}
};
