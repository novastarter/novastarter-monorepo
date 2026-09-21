/**
 * Options every limiter shares: the budget of a key.
 */
export type LimiterDriverConfigBase = {
	/** Length of the window in seconds, after which a key's points are restored. */
	duration: number;

	/** Number of points every key may consume per window. */
	points: number;
};
