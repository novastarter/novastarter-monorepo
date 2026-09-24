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
	// An `Error` is answered with as it is: wrapping it would hide its class from `instanceof` checks downstream.
	// The check itself may throw — a revoked `Proxy` refuses every operation — and a value like that is wrapped
	// like any other, since a helper for `catch` clauses must never throw itself
	try {
		if (value instanceof Error) {
			return value;
		}
	} catch {
		// Not an `Error` that can be told apart; falls through to the wrapping below
	}

	// Anything else is wrapped; the original stays reachable as `cause` for a handler that knows the vendor's shape
	return new Error(toErrorMessage(value), { cause: value });
};
