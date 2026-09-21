import { toErrorMessage } from './to-error-message.js';

/**
 * Make sure a thrown value is an `Error`.
 *
 * An `Error` passes through as the same instance, so its class, its own fields and its stack survive. Anything else —
 * a string, a number, a plain object a vendor SDK rejected with — is wrapped in a new `Error` whose message is
 * {@link toErrorMessage} of the value and whose `cause` is the value itself, so nothing that was thrown is lost. Use it
 * where code needs an `Error` — to rethrow, to pass as a `cause`, to read a `.message` — from a `catch (error)` that
 * holds `unknown`.
 *
 * @param value - Whatever was thrown or rejected with.
 * @returns The value when it is an `Error`, otherwise an `Error` wrapping it.
 * @example
 * ```ts
 * toError(new RangeError('boom')) instanceof RangeError;
 * // => true
 *
 * toError('boom');
 * // => Error: boom, with `cause` 'boom'
 * ```
 */
export const toError = (value: unknown): Error => {
	// 1. An `Error` is answered with as it is: wrapping it would hide its class from `instanceof` checks downstream
	if (value instanceof Error) {
		return value;
	}

	// 2. Anything else is wrapped; the original stays reachable as `cause` for a handler that knows the vendor's shape
	return new Error(toErrorMessage(value), { cause: value });
};
