import { RateLimiterMemory } from 'rate-limiter-flexible';
import type { LimiterDriver } from '../../driver.js';
import type { LimiterDriverConfigBase } from '../../types.js';
import { assertBudget } from '../../utils/assert-budget.js';
import { consume } from '../../utils/consume.js';

/**
 * Options of {@link LimiterDriverLocal}, the `local` driver; the budget alone.
 */
export type LimiterDriverLocalConfig = LimiterDriverConfigBase;

/**
 * In-process rate limiter over `rate-limiter-flexible`'s memory store.
 *
 * Consumption is tracked per process, so with several processes each one enforces the limit on its own.
 *
 * @example
 * ```ts
 * const limiter = new LimiterDriverLocal({
 * 	points: 10,
 * 	duration: 5,
 * });
 *
 * await limiter.consume(request.ip);
 * ```
 */
export class LimiterDriverLocal implements LimiterDriver {
	/**
	 * Underlying limiter doing the bookkeeping.
	 *
	 * @internal
	 */
	private readonly limiter: RateLimiterMemory;

	/**
	 * Configured points per window, reported in the error when a key runs out.
	 *
	 * @internal
	 */
	private readonly points: number;

	/**
	 * Create the limiter with its points and window.
	 *
	 * @param config - Local configuration.
	 * @throws `InvalidConfigError` when `duration` is not a whole number of seconds of at least 1, or `points` is not a whole
	 * number of at least 0.
	 */
	constructor(config: LimiterDriverLocalConfig) {
		// The memory store would honour a sub-second window that the Redis store cannot; refusing it here keeps one
		// configuration meaning the same on both backends
		assertBudget('LimiterDriverLocal', config);

		// The points are kept for error reporting
		this.limiter = new RateLimiterMemory({
			duration: config.duration,
			points: config.points,
		});

		this.points = config.points;
	}

	/**
	 * Consume one point for the given key.
	 *
	 * @param key - IP address, URL path or any other string identifying the caller.
	 * @throws `HitRateLimitError` when the key has no points left in the current window.
	 */
	async consume(key: string): Promise<void> {
		// The shared handler translates the library's rejection into a `HitRateLimitError`
		return await consume(this.limiter, key, this.points);
	}

	/**
	 * Forget the tracked consumption of a key.
	 *
	 * @param key - IP address, URL path or any other string identifying the caller.
	 */
	async delete(key: string): Promise<void> {
		// The library owns the per-key window and its expiry timer, so the reset has to go through it rather than any
		// state of our own
		await this.limiter.delete(key);
	}
}
