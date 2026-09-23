import { toErrorMessage } from '@novastarter/utils';
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
	// 1. Twilio answered: the status and its own code are what the caller acts on, the help URL what a developer reads
	if (error instanceof twilio.RestException) {
		const moreInfo = error.moreInfo ? ` (${error.moreInfo})` : '';

		return new Error(`Twilio: ${error.status} ${error.code ?? 'unknown'}: ${error.message}${moreInfo}`, {
			cause: error,
		});
	}

	// 2. A transport failure of the SDK's axios carries the request config — the `Authorization` header with the
	//    credentials — so it is described without being passed on
	if (isAxiosLike(error)) {
		return describeTransportError(error);
	}

	// 3. Anything else — a bad key, a thrown value — as is, prefixed
	return new Error(`Twilio: ${toErrorMessage(error)}`, { cause: error });
};

/**
 * Describe a failure of the SDK's HTTP client — a timeout, a refused connection — without keeping the error itself.
 *
 * An axios error holds the request config, the `Authorization` header with the account's credentials included, so
 * the error returned names its code and message only and has no `cause`.
 *
 * @param error - What the SDK's client threw.
 * @returns A plain error naming the code and the message, with no cause.
 * @example
 * ```ts
 * await client.request(options).catch((error: unknown) => {
 * 	throw describeTransportError(error);
 * });
 * ```
 */
export const describeTransportError = (error: unknown): Error => {
	// 1. The code (`ECONNABORTED`, `ENOTFOUND`) is what a caller matches on; the message of axios names no header
	const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
	const prefix = typeof code === 'string' && code ? `${code}: ` : '';

	return new Error(`Twilio: ${prefix}${toErrorMessage(error)}`);
};

/**
 * Tell an error of axios — the SDK's HTTP client — or one shaped like it, by the request config it carries.
 *
 * @param error - What was thrown.
 * @returns Whether it is an axios error, or holds a request config, request or response.
 * @internal
 */
const isAxiosLike = (error: unknown): boolean => {
	// 1. `isAxiosError` marks the real one; any error holding a `config` or a `request` may hold the headers too
	if (typeof error !== 'object' || error === null) return false;

	return (
		('isAxiosError' in error && error.isAxiosError === true) ||
		'config' in error ||
		'request' in error ||
		'response' in error
	);
};
