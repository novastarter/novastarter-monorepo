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
	 * Hold the lock for this much longer, counted from now rather than added to the current expiry.
	 *
	 * May be called as often as a long-running holder needs; the local store has nothing to extend and treats it as a
	 * no-op.
	 *
	 * @param duration - Time to hold the lock from now, in milliseconds.
	 * @returns Resolves once the lock is extended.
	 */
	extend(duration: number): Promise<void>;
}
