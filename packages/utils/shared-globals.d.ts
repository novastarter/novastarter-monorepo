/**
 * The host globals the shared entry point is allowed to use.
 *
 * `tsconfig.shared.json` type-checks `src` (minus `src/node` and the tests) without `@types/node` and without the
 * `DOM` lib, so a stray `process`, `window` or `fetch` fails the check instead of failing at runtime on the other
 * platform. The ES lib alone declares no timers and no abort signals, though, and `sleep`, `retry` and `withTimeout`
 * need them — every runtime provides them, so the minimum those helpers use is declared here, and nothing more.
 *
 * Only that tsconfig includes this file: `tsconfig.json` and the tsdown build see `@types/node`, whose declarations
 * these would clash with.
 */

/**
 * Arm a one-shot timer, as `sleep` and `withTimeout` do for their deadline.
 *
 * @param callback - Run once the delay is up.
 * @param ms - Delay in milliseconds.
 * @returns The handle to cancel it with; typed `unknown` because Node hands out an object and browsers a number.
 */
declare function setTimeout(callback: () => void, ms?: number): unknown;

/**
 * Cancel a timer armed by {@link setTimeout}, so a settled operation leaves no pending deadline behind.
 *
 * @param handle - What `setTimeout` answered with.
 */
declare function clearTimeout(handle: unknown): void;

/**
 * The part of an `AbortSignal` the helpers read and subscribe to.
 *
 * Declared as an interface, so the runtime's own class satisfies it without a cast.
 */
interface AbortSignal {
	/**
	 * Whether `abort()` was already called, checked up front so an aborted signal never arms a timer.
	 */
	readonly aborted: boolean;

	/**
	 * What `abort()` was called with; the helpers reject with it as it is.
	 */
	readonly reason: unknown;

	/**
	 * Subscribe to the abort, `once` so a listener that fired is not kept on a long-lived shutdown signal.
	 *
	 * @param type - Only `abort` is ever listened for.
	 * @param listener - Run when the signal aborts.
	 * @param options - `once` drops the listener after its first call.
	 */
	addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;

	/**
	 * Unsubscribe once the operation settled by itself, so a shared signal does not accumulate dead listeners.
	 *
	 * @param type - Only `abort` is ever listened for.
	 * @param listener - The listener handed to {@link AbortSignal.addEventListener}.
	 */
	removeEventListener(type: 'abort', listener: () => void): void;
}

/**
 * The part of `AbortController` that `withTimeout` uses to abort the signal it hands a function operation.
 */
declare class AbortController {
	/**
	 * The signal given to the operation, aborted at the deadline or when the caller's signal aborts.
	 */
	readonly signal: AbortSignal;

	/**
	 * Abort the signal, passing the reason on to whoever reads `signal.reason`.
	 *
	 * @param reason - The error the operation should fail with.
	 */
	abort(reason?: unknown): void;
}
