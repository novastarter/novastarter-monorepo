import { toErrorMessage } from '@novastarter/utils';

/**
 * Turn what the SDK threw into an error naming the provider, the original as the cause.
 *
 * @param error - What `node-mailjet` threw — its `MailjetError` carries the status and Mailjet's message.
 * @returns The error to raise.
 */
export const describeError = (error: unknown): Error =>
	// 1. The SDK's message already carries its details; the provider's name is added, so the log says who refused
	new Error(`Mailjet: ${toErrorMessage(error)}`, { cause: error });
