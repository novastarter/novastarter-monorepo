import { toErrorMessage } from '@novastarter/utils';

/**
 * Turn what the SDK threw into an error naming the provider, the original as the cause.
 *
 * @param error - What the SDK threw — its `MailtrapError` lists Mailtrap's errors.
 * @returns The error to raise.
 */
export const describeError = (error: unknown): Error =>
	// The provider's name is added so the log says who refused; the SDK's message already carries the details
	new Error(`Mailtrap: ${toErrorMessage(error)}`, { cause: error });
