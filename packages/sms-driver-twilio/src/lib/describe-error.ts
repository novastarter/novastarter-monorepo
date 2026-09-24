import { DEFAULT_REQUEST_TIMEOUT } from '@novastarter/http';
import { TimeoutError, toErrorMessage } from '@novastarter/utils';
import twilio from 'twilio';

/**
 * Turn what the Twilio SDK throws, or reports on an accepted message, into the error `sendSms()` expects.
 *
 * A `RestException` carries Twilio's own error code — `21211` for an unusable number, `21610` for a recipient who
 * unsubscribed — which is what an application matches on, so the code and the help URL stay in the message and the
 * original travels as the `cause`. A failure of the SDK's HTTP client is not passed on: it carries the credentials.
 *
 * @param error - What was thrown: a `RestException` for an answered request, a plain error for the network.
 * @returns An error naming the status, the code and the reason, with the original as its cause unless it is an axios
 * error.
 * @example
 * ```ts
 * try {
 * 	await client.messages.create(payload);
 * } catch (error) {
 * 	throw describeError(error);
 * }
 * ```
 */
export const describeError = (error: unknown): Error => {
	// The status and Twilio's own code are what the caller acts on; the help URL is what a developer reads.
	if (error instanceof twilio.RestException) {
		const moreInfo = error.moreInfo ? ` (${error.moreInfo})` : '';

		return new Error(`Twilio: ${error.status} ${error.code ?? 'unknown'}: ${error.message}${moreInfo}`, {
			cause: error,
		});
	}

	// A transport failure of the SDK's axios carries the request config, with the credentials in the `Authorization`
	// header, so it is described without being passed on.
	if (isAxiosLike(error)) {
		return describeTransportError(error);
	}

	return new Error(`Twilio: ${toErrorMessage(error)}`, { cause: error });
};

/**
 * Describe a failure of the SDK's HTTP client — a timeout, a refused connection — without keeping the error itself.
 *
 * An axios error holds the request config, the `Authorization` header with the account's credentials included, so
 * the error returned names its code and message only and has no `cause`. One exception: the axios timeout —
 * `ECONNABORTED` — becomes the kit's `TimeoutError` with the deadline the request config carried. The SDK is given the
 * same deadline `call()` races it against, so the axios timeout almost always wins the race; reported as a plain
 * error, it would slip past every caller matching `TimeoutError`.
 *
 * @param error - What the SDK's client threw.
 * @returns The kit's `TimeoutError` for the SDK's axios timeout; otherwise a plain error naming the code and the
 * message, with no cause.
 * @example
 * ```ts
 * await client.request(options).catch((error: unknown) => {
 * 	throw describeTransportError(error);
 * });
 * ```
 */
export const describeTransportError = (error: unknown): Error => {
	// The code (`ECONNABORTED`, `ENOTFOUND`) is what a caller matches on; the axios message names no header.
	const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;

	// The axios timeout becomes the kit's TimeoutError, so a caller matching it catches the race the SDK usually wins.
	// The error holds the credentials in its config, so only the deadline is read off it.
	if (code === 'ECONNABORTED') {
		return new TimeoutError(deadlineOf(error));
	}

	const prefix = typeof code === 'string' && code ? `${code}: ` : '';

	return new Error(`Twilio: ${prefix}${toErrorMessage(error)}`);
};

/**
 * Read the deadline an axios timeout aborted on — the `timeout` of the request config the error carries.
 *
 * The config itself is never kept: it holds the `Authorization` header. Only the deadline number is taken, and an
 * error without one — hand-rolled in a test, cut down by a wrapper — falls back to the SDK's default request timeout.
 *
 * @param error - The axios error, or one shaped like it.
 * @returns The deadline in milliseconds.
 * @internal
 */
const deadlineOf = (error: unknown): number => {
	// The config is reached for its `timeout` field only.
	const config =
		typeof error === 'object' && error !== null && 'config' in error
			? (error.config as { timeout?: unknown } | undefined)
			: undefined;

	const timeout = config?.timeout;

	// Without a usable deadline on the error, the SDK's own default is the closest there is.
	return typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : DEFAULT_REQUEST_TIMEOUT;
};

/**
 * Tell an error of axios — the SDK's HTTP client — or one shaped like it, by the request config it carries.
 *
 * @param error - What was thrown.
 * @returns Whether it is an axios error, or holds a request config, request or response.
 * @internal
 */
const isAxiosLike = (error: unknown): boolean => {
	// `isAxiosError` marks the real one; any error holding a `config` or a `request` may hold the headers too.
	if (typeof error !== 'object' || error === null) return false;

	return (
		('isAxiosError' in error && error.isAxiosError === true) ||
		'config' in error ||
		'request' in error ||
		'response' in error
	);
};
