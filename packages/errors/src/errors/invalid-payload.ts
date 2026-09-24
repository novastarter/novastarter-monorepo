import { ErrorCode } from '../codes.js';
import { createError, type NovastarterErrorConstructor } from '../create-error.js';

/**
 * Details of a rejected payload.
 */
export interface InvalidPayloadErrorExtensions {
	/** What is wrong with the payload, as a sentence fragment the message is completed with. */
	reason: string;
}

/**
 * Build the message of an {@link InvalidPayloadError} from its extensions.
 *
 * @param extensions - The reason the payload was rejected.
 * @returns Message naming the reason, so the caller knows what to fix.
 */
export const invalidPayloadMessage = (extensions: InvalidPayloadErrorExtensions): string => {
	// The reason is a fragment without a full stop, so the message closes it — one sentence, one period
	return `Invalid payload. ${extensions.reason}.`;
};

/**
 * Error thrown when a payload does not pass a check: a missing field, a wrong shape, a value out of range.
 *
 * Answers with HTTP 400 and carries the reason, so a transport layer can hand it to the caller as is. Structured
 * details about the failing fields, when the check produced them, travel in the standard `cause`.
 *
 * @example
 * ```ts
 * throw new InvalidPayloadError({ reason: 'Field "email" is required' });
 * ```
 */
export const InvalidPayloadError: NovastarterErrorConstructor<InvalidPayloadErrorExtensions> =
	createError<InvalidPayloadErrorExtensions>(ErrorCode.InvalidPayload, invalidPayloadMessage, 400);
