/**
 * Rate limiter shared by the local and Redis backends.
 *
 * Every key gets `points` per `duration` seconds; consuming past that budget throws.
 */
export interface Limiter {
	/**
	 * Consume one point for the given key.
	 *
	 * @param key - IP address, URL path or any other string identifying the caller.
	 * @returns Resolves when the point was available.
	 * @throws `HitRateLimitError` when the key has no points left in the current window.
	 */
	consume(key: string): Promise<void>;

	/**
	 * Forget the tracked consumption of a key.
	 *
	 * @param key - IP address, URL path or any other string identifying the caller.
	 * @returns Resolves once the key is reset.
	 */
	delete(key: string): Promise<void>;
}
