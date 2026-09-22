/**
 * Options every limiter shares: the budget of a key.
 */
export type LimiterDriverConfigBase = {
	/**
	 * Length of the window in whole seconds, at least 1, after which a key's points are restored.
	 *
	 * Redis expires a key in whole seconds, so a fraction would be a shorter window in memory and, below one second,
	 * no window at all in Redis; both drivers refuse anything but a positive integer.
	 */
	duration: number;

	/** Number of points every key may consume per window; a whole number, `0` for a key that is always over budget. */
	points: number;
};
