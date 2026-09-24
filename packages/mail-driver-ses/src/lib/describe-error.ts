import { toErrorMessage } from '@novastarter/utils';

/**
 * Turn what the SDK threw into an error naming the provider, the original as the cause.
 *
 * @param error - What the SES SDK or nodemailer threw on a refused send.
 * @returns The error to raise.
 */
export const describeError = (error: unknown): Error =>
	// The provider's name is added so the log says who refused; the error already carries the details
	new Error(`SES: ${toErrorMessage(error)}`, { cause: error });
