import { toErrorMessage } from '@novastarter/utils';

/**
 * Turn the SDK's failure value into an error naming the provider, the value as the cause.
 *
 * @param error - What the SDK reported in the `error` field of its answer — an object naming the refusal in `name`
 * and `message`.
 * @returns The error to raise.
 */
export const describeError = (error: unknown): Error => {
	// Both `name` and `message` go into the line, so the log says what kind of refusal it was, not only its text
	if (typeof error === 'object' && error !== null && 'name' in error && 'message' in error) {
		return new Error(`Resend: ${String(error.name)}: ${String(error.message)}`, { cause: error });
	}

	// Anything shaped otherwise, a thrown string or number, is written as text so it is never dropped or read as
	// `undefined`
	return new Error(`Resend: ${toErrorMessage(error)}`, { cause: error });
};
