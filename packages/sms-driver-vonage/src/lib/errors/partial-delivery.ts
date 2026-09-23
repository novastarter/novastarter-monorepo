import { createError, type NovastarterErrorConstructor } from '@novastarter/errors';
import { SMS_PARTIAL_DELIVERY_CODE } from '@novastarter/sms';

/**
 * Context of {@link SmsPartialDeliveryError}.
 */
export interface SmsPartialDeliveryErrorExtensions {
	/** How many parts of the message Vonage accepted — these went out and are billed. */
	delivered: number;
	/** How many parts the text was split into, delivered and refused together. */
	parts: number;
	/** The status and wording of the first refused part, what an application matches on otherwise. */
	reason: string;
}

/**
 * Thrown by the Vonage driver when Vonage accepts some parts of a long text and refuses the others: the SDK raises a
 * `MessageSendPartialFailure` for that, and the accepted parts are already on their way.
 *
 * Not a failure to retry — re-sending the text, by a fallback location or a caller's retry, would deliver the accepted
 * parts again and bill them twice. The code is {@link SMS_PARTIAL_DELIVERY_CODE} of `@novastarter/sms`: the chain
 * matches it and rethrows this error as-is instead of falling back, and a caller matches it to report the message as
 * partially delivered.
 *
 * @example
 * ```ts
 * try {
 * 	await sendSms({ to: user.phone, text: longText });
 * } catch (error) {
 * 	if (error instanceof SmsPartialDeliveryError) await flagPartialDelivery(user.phone);
 * }
 * ```
 */
export const SmsPartialDeliveryError: NovastarterErrorConstructor<SmsPartialDeliveryErrorExtensions> =
	createError<SmsPartialDeliveryErrorExtensions>(
		SMS_PARTIAL_DELIVERY_CODE,
		({ delivered, parts, reason }) =>
			`The sms was partially delivered: ${delivered} of ${parts} parts went out; do not re-send, those parts would go out twice (${reason})`,
	);
