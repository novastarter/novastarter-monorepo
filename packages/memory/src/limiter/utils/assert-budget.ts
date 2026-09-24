import { InvalidConfigError } from '@novastarter/errors';
import type { LimiterDriverConfigBase } from '../types.js';

/**
 * Refuse a budget the two backends would not enforce alike.
 *
 * `rate-limiter-flexible` takes `duration` as seconds and expires a Redis key in whole seconds: a fraction is a shorter
 * window in memory and, below one second, no window at all in Redis, where the key then never resets. A negative
 * `points` is silently replaced by the library's default of 4. Both are refused up front, so a configuration that
 * would behave differently per backend fails at start-up rather than in production.
 *
 * @param driver - Name of the driver, for the error message.
 * @param config - The budget as the caller configured it.
 * @throws {@link InvalidConfigError} when `duration` is not a whole number of at least 1, or `points` is not a whole number of at
 * least 0.
 */
export const assertBudget = (driver: string, config: LimiterDriverConfigBase): void => {
	// At least one whole second: the shortest window Redis can expire
	if (!(Number.isInteger(config.duration) && config.duration >= 1)) {
		throw new InvalidConfigError({
			reason: `${driver} needs "duration" as a whole number of seconds of at least 1, got ${config.duration}`,
		});
	}

	// Whole points only, and none is allowed: a budget of `0` refuses every call, which is a valid way to close a key;
	// a negative one would silently become the library's default
	if (!(Number.isInteger(config.points) && config.points >= 0)) {
		throw new InvalidConfigError({
			reason: `${driver} needs "points" as a whole number of at least 0, got ${config.points}`,
		});
	}
};
