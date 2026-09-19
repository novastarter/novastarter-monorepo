/**
 * Handle on a lock acquired through `Kv.acquireLock`.
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
