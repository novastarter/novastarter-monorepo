import { toErrorMessage } from '@novastarter/utils';

/**
 * Turn what the SDK threw into an error naming the provider, the original as the cause.
 *
 * @param error - What the SDK threw — its `PostmarkError` carries the code and the status.
 * @returns The error to raise.
 */
export const describeError = (error: unknown): Error =>
	// The provider's name is added so the log says who refused; the SDK's message already carries the details
	new Error(`Postmark: ${toErrorMessage(error)}`, { cause: error });
