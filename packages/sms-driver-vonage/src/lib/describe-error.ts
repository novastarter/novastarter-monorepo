import { toErrorMessage } from '@novastarter/utils';
import { SMSFailure } from '@vonage/sms';
import { SmsPartialDeliveryError } from './errors/index.js';

/**
 * Turn what the Vonage SDK throws into the error `sendSms()` expects.
 *
 * Vonage answers `200` even for a message it refused, with a status code per part of the message; the SDK turns that
 * into an `SMSFailure`, whose first failed part carries the status — `4` for bad credentials, `15` for a sender the
 * destination does not allow — and Vonage's own wording. Both stay in the message, the SDK's error travels as the
 * `cause`, so the whole answer including the parts that did go out remains reachable.
 *
 * A partial failure is different: Vonage accepted some parts of a long text before refusing the rest, and the accepted
 * parts are already delivered and billed. It becomes the non-retryable {@link SmsPartialDeliveryError}, so a fallback
 * or a caller's retry does not send those parts again. The parts decide which case it is, not the SDK's error class:
 * the SDK compares its failure count with Vonage's `message-count`, which arrives as a string, so it throws
 * `MessageSendPartialFailure` even for a message refused whole.
 *
 * @param error - What was thrown: an `SMSFailure` for a refused message, a plain error for the network.
 * @returns The non-retryable {@link SmsPartialDeliveryError} for a partially delivered message; otherwise an error
 * naming the status and the reason, with the original as its cause.
 * @example
 * ```ts
 * try {
 * 	await client.send(params);
 * } catch (error) {
 * 	throw describeError(error);
 * }
 * ```
 */
export const describeError = (error: unknown): Error => {
	if (error instanceof SMSFailure) {
		const failed = error.getFailedMessages()[0];
		const reason = `${failed?.status ?? 'unknown'}: ${failed?.errorText ?? error.message}`;
		const delivered = error.getSuccessfulMessages().length;

		// 1. Vonage took some parts and refused the rest: the delivered parts already went out, so this is reported as the
		//    non-retryable SmsPartialDeliveryError — reading it as a refusal would have the chain re-send those parts
		if (delivered > 0) {
			return new SmsPartialDeliveryError({ delivered, parts: error.getMessages().length, reason }, { cause: error });
		}

		// 2. Vonage refused the whole message, whichever class the SDK chose: the first failed part says why, and the rest
		//    of the answer stays on the cause
		return new Error(`Vonage: ${reason}`, { cause: error });
	}

	// 3. Anything else — the network, a bad host — as is, prefixed
	return new Error(`Vonage: ${toErrorMessage(error)}`, { cause: error });
};
