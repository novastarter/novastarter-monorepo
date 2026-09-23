import type { HttpCallFetch } from '@novastarter/http';

/**
 * What `JSON.parse` hands a reviver as its third argument: the source text of a primitive value.
 *
 * @internal
 */
type ReviverContext = { source?: string };

/**
 * Rewrite a JSON text so every integer too large for a `number` becomes a string of its exact digits.
 *
 * Mailjet's message ids are around 2^60, above `Number.MAX_SAFE_INTEGER`, and a plain `JSON.parse` rounds them. The
 * SDK's `send()` reads them as strings (json-bigint with `storeAsString`), so the same is done here to keep `call()`
 * answers exact and matching the `messageId` of a send. The reviver's source text access gives the digits as sent.
 * A text that is not JSON, or has no such integer, comes back unchanged.
 *
 * @param text - The body of an answer.
 * @returns The body with its unsafe integers quoted.
 */
export const quoteUnsafeIntegers = (text: string): string => {
	let found = false;
	let parsed: unknown;

	// 1. Parse with a reviver that swaps an unsafe integer for its source digits; a fraction or an exponent is left a
	//    number, since only whole ids lose meaning when rounded
	try {
		parsed = JSON.parse(text, (_key: string, value: unknown, context?: ReviverContext): unknown => {
			if (
				typeof value === 'number' &&
				!Number.isSafeInteger(value) &&
				context?.source !== undefined &&
				/^-?\d+$/.test(context.source)
			) {
				found = true;

				return context.source;
			}

			return value;
		});
	} catch {
		return text;
	}

	// 2. Nothing to quote keeps the text byte for byte, so the answer is read exactly as it would be without this
	return found ? JSON.stringify(parsed) : text;
};

/**
 * The `fetch` of Mailjet's `call()`: the global one, with every unsafe integer of a successful answer turned into a
 * string by {@link quoteUnsafeIntegers} before `@novastarter/http` parses it.
 *
 * @param url - Where the request goes.
 * @param init - The request's method, headers, body, signal and `redirect: 'manual'`, passed on untouched.
 * @returns The answer, its body rewritten when it is a 2xx with content.
 */
export const mailjetFetch: HttpCallFetch = async (url, { body, ...init }) => {
	// 1. `exactOptionalPropertyTypes` refuses an explicit `body: undefined`, so it is left out instead; the global is
	//    read per call so a stub in tests is picked up
	const response = await fetch(url, body === undefined ? init : { ...init, body });

	// 2. Only a successful answer with a body carries ids worth keeping; errors, redirects and empty answers go through
	//    as they are, and a 204 or 205 cannot be rebuilt with a body anyway
	if (!response.ok || response.status === 204 || response.status === 205) {
		return response;
	}

	// 3. The body is read under the request's signal and rebuilt; its length and encoding no longer describe the new
	//    text, so those headers are dropped
	const text = quoteUnsafeIntegers(await response.text());
	const headers = new Headers(response.headers);

	headers.delete('content-length');
	headers.delete('content-encoding');

	return new Response(text, { status: response.status, statusText: response.statusText, headers });
};
