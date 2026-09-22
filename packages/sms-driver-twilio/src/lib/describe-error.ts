import { toErrorMessage } from '@novastarter/utils';
import twilio from 'twilio';

/**
 * Turn what the Twilio SDK throws, or reports on an accepted message, into the error `sendSms()` expects.
 *
 * A `RestException` carries Twilio's own error code — `21211` for an unusable number, `21610` for a recipient who
 * unsubscribed — which is what an application matches on, so the code and the help URL stay in the message and the
 * original travels as the `cause`.
 *
 * @param error - What was thrown: a `RestException` for an answered request, a plain error for the network.
 * @returns An error naming the status, the code and the reason, with the original as its cause.
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

	// 2. Anything else — the network, a bad key — as is, prefixed
	return new Error(`Twilio: ${toErrorMessage(error)}`, { cause: error });
};
