import { toErrorMessage } from '@novastarter/utils';

/**
 * Re-throw an error of the SDK with the provider named, the original as the cause.
 *
 * @param error - What `mailgun.js` threw — its `APIError` carries the status and Mailgun's message.
 * @returns Never; the type lets it sit in a `.catch()`.
 * @throws Always.
 */
export const rethrowMailgunError = (error: unknown): never => {
	// The SDK's message already names the status and Mailgun's reason; only the provider is added
	const details = toErrorMessage(error);

	throw new Error(`Mailgun: ${details}`, { cause: error });
};
