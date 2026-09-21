/**
 * Value that may or may not be wrapped in a promise.
 *
 * The local store answers synchronously while Redis answers asynchronously; callers `await` either way.
 *
 * @typeParam T - The unwrapped value.
 */
export type MaybePromise<T> = Promise<T> | T;

/**
 * Handle on a lock acquired through `KvDriver.acquireLock`.
 */
export interface Lock {
	/**
	 * Give the lock back so other holders can acquire it.
	 *
	 * @returns Resolves once the lock is released.
	 */
	release(): Promise<void>;

	/**
	 * Push the lock's expiry further into the future.
	 *
	 * @param duration - Extra time to hold the lock, in milliseconds.
	 * @returns Resolves once the lock is extended.
	 */
	extend(duration: number): Promise<void>;
}
