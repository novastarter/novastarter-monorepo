import { toErrorMessage } from '@novastarter/utils';

/**
 * Turn what the SDK threw into an error naming the provider, the original as the cause.
 *
 * @param error - What the SES SDK or nodemailer threw on a refused send.
 * @returns The error to raise.
 */
export const describeError = (error: unknown): Error =>
	// 1. The error already carries its details; the provider's name is added, so the log says who refused
	new Error(`SES: ${toErrorMessage(error)}`, { cause: error });
