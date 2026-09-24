import { ErrorCode } from '../codes.js';
import { createError, type NovastarterErrorConstructor } from '../create-error.js';
import { HitRateLimitError } from './hit-rate-limit.js';

/**
 * Details of a refused `call()` to a provider's API.
 */
export interface ProviderCallErrorExtensions {
	/** The provider: `stripe`, `twilio`, `resend`. */
	provider: string;
	/** The method as the caller wrote it: `POST /v1/refunds`, `GetAccount`. */
	method: string;
	/** The provider's HTTP status. */
	status: number;
	/** The provider's answer, parsed, for a caller that wants its error code or fields. */
	body: unknown;
}

/**
 * The longest part of the provider's answer quoted in the message; the whole answer stays in `extensions.body`.
 *
 * @defaultValue 300 characters.
 */
export const PROVIDER_CALL_MESSAGE_LIMIT = 300;

/**
 * Pick a human-readable reason out of a provider's error answer.
 *
 * Providers word their refusals in a handful of shapes: `{ message }`, `{ error: { message | detail } }`, `{ error,
 * error_description }`, `{ errors: [{ detail | message | title }] }`, `{ detail }`, `{ description }`, `{ Message }`,
 * `{ ErrorMessage }`, `{ errors: ['…'] }`, or a text body. The first that is there is the reason.
 *
 * @param body - The parsed answer.
 * @returns The reason, cut to {@link PROVIDER_CALL_MESSAGE_LIMIT}; `undefined` when the answer names none.
 */
export const providerErrorReason = (body: unknown): string | undefined => {
	// A text answer — an HTML error page, an XML one — is its own reason
	if (typeof body === 'string') {
		return clip(body);
	}

	if (!body || typeof body !== 'object') {
		return undefined;
	}

	// The shapes in the order they are most specific; a nested `error` object is looked into as well
	const record = body as Record<string, unknown>;

	const nested =
		typeof record['error'] === 'object' && record['error'] ? (record['error'] as Record<string, unknown>) : {};

	const errors = record['errors'];
	const head: unknown = Array.isArray(errors) ? errors[0] : errors;
	const first = head && typeof head === 'object' ? (head as Record<string, unknown>) : undefined;

	const candidates = [
		nested['message'],
		nested['detail'],
		record['error_description'],
		record['message'],
		first?.['detail'],
		first?.['message'],
		first?.['title'],
		record['detail'],
		record['description'],
		record['Message'],
		record['ErrorMessage'],
		typeof record['error'] === 'string' ? record['error'] : undefined,
		typeof head === 'string' ? head : undefined,
	];

	const reason = candidates.find(
		(candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
	);

	return reason === undefined ? undefined : clip(reason);
};

/**
 * Build the message of a {@link ProviderCallError} from its extensions.
 *
 * @param extensions - The provider, the method, the status and the answer.
 * @returns `<provider> refused <method>: <status> <reason>`; never a credential, since none is in the extensions.
 */
export const providerCallMessage = (extensions: ProviderCallErrorExtensions): string => {
	const reason = providerErrorReason(extensions.body);

	return `${extensions.provider} refused ${extensions.method}: ${extensions.status}${reason ? ` ${reason}` : ''}`;
};

/**
 * Error thrown by a driver's `call()` when the provider answers with an error status.
 *
 * Status 502: the provider, not the caller of the application, refused. The provider's own status and answer are in
 * `extensions`, so code that made the call can tell a 404 from a 422 and read the provider's error code.
 *
 * @example
 * ```ts
 * try {
 * 	await usePayments().location('stripe').call?.('POST /v1/refunds', { payment_intent: id });
 * } catch (error) {
 * 	if (error instanceof ProviderCallError && error.extensions.status === 404) {
 * 		// no such payment
 * 	}
 * }
 * ```
 */
export const ProviderCallError: NovastarterErrorConstructor<ProviderCallErrorExtensions> =
	createError<ProviderCallErrorExtensions>(ErrorCode.ProviderCallFailed, providerCallMessage, 502);

/**
 * The response headers {@link toProviderCallError} reads: any `Headers`, or a plain record.
 */
export type ProviderCallHeaders =
	{ get(name: string): string | null } | Record<string, string | string[] | undefined> | undefined;

/**
 * What {@link toProviderCallError} takes.
 */
export interface ToProviderCallErrorOptions extends ProviderCallErrorExtensions {
	/** The response headers, for `Retry-After` on a 429. */
	headers?: ProviderCallHeaders;
	/** The wait before a retry, in seconds, when the provider names it in the body rather than a header. */
	retryAfter?: number | undefined;
	/** The error the answer came as — an SDK's exception — kept as the `cause`. */
	cause?: unknown;
}

/**
 * Turn a provider's error answer to a `call()` into the kit's error: a 429 into a {@link HitRateLimitError} reset at
 * `Retry-After`, anything else into a {@link ProviderCallError}.
 *
 * @param options - The provider, the method, the status, the answer, and the headers.
 * @returns The error to throw.
 * @example
 * ```ts
 * if (response.status >= 400) {
 * 	throw toProviderCallError({
 * 		provider: 'polar',
 * 		method,
 * 		status: response.status,
 * 		body: response.body,
 * 		headers: response.headers,
 * 	});
 * }
 * ```
 */
export const toProviderCallError = (options: ToProviderCallErrorOptions): Error => {
	const { provider, method, status, body, headers, cause } = options;

	// Too many requests: the caller may try again once the provider's wait is over — one second when it names none
	if (status === 429) {
		const named = options.retryAfter;

		const seconds =
			(named !== undefined && Number.isFinite(named) ? clampWait(named) : undefined) ??
			retryAfterSeconds(readHeader(headers, 'retry-after')) ??
			1;

		return new HitRateLimitError(
			{ limit: 0, reset: new Date(Date.now() + seconds * 1000) },
			cause === undefined ? undefined : { cause },
		);
	}

	// Everything else keeps the provider's status and answer for the caller to read
	return new ProviderCallError({ provider, method, status, body }, cause === undefined ? undefined : { cause });
};

/**
 * Read a header from `Headers` or a plain record, case-insensitively.
 *
 * @param headers - The headers.
 * @param name - The header, lower-case.
 * @returns Its value, the first of a list; `undefined` when absent.
 * @internal
 */
const readHeader = (headers: ProviderCallHeaders, name: string): string | undefined => {
	// A `Headers` object answers by itself; a record is searched by lower-cased key
	if (!headers) return undefined;

	if (typeof headers.get === 'function') {
		return (headers as { get(name: string): string | null }).get(name) ?? undefined;
	}

	const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];

	return Array.isArray(entry) ? entry[0] : (entry as string | undefined);
};

/**
 * The seconds a `Retry-After` value asks for: a number of seconds, or an HTTP date.
 *
 * @param value - The header's value.
 * @returns The seconds, not below zero; `undefined` for a missing or unreadable value.
 * @internal
 */
const retryAfterSeconds = (value: string | undefined): number | undefined => {
	// Seconds first, the common form; a date is the time left until it. A blank value names no wait at all
	if (value === undefined || value.trim() === '') return undefined;

	const seconds = Number(value);

	if (Number.isFinite(seconds)) return clampWait(seconds);

	const date = Date.parse(value);

	return Number.isNaN(date) ? undefined : clampWait((date - Date.now()) / 1000);
};

/**
 * The longest wait a provider may ask for, in seconds: a day. Anything longer is treated as a day, so the reset stays
 * a valid date a transport layer can write into its own `Retry-After`.
 *
 * @defaultValue 86 400 seconds.
 */
export const MAX_RETRY_AFTER = 86_400;

/**
 * Keep a wait between zero and {@link MAX_RETRY_AFTER}.
 *
 * @param seconds - The wait the provider asked for.
 * @returns The wait, clamped.
 * @internal
 */
const clampWait = (seconds: number): number => {
	// A negative wait is "now", an absurd one a day
	return Math.min(MAX_RETRY_AFTER, Math.max(0, seconds));
};

/**
 * Cut a reason to {@link PROVIDER_CALL_MESSAGE_LIMIT}, whitespace folded, so an HTML page does not flood the log.
 *
 * @param text - The reason.
 * @returns The reason, cut with an ellipsis when it was longer.
 * @internal
 */
const clip = (text: string): string | undefined => {
	// One line, trimmed; an empty text names no reason
	const folded = text.replace(/\s+/g, ' ').trim();

	if (folded.length === 0) return undefined;

	return folded.length > PROVIDER_CALL_MESSAGE_LIMIT ? `${folded.slice(0, PROVIDER_CALL_MESSAGE_LIMIT)}…` : folded;
};
