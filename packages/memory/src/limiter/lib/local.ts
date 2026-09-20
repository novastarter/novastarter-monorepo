import { RateLimiterMemory } from 'rate-limiter-flexible';
import type { Limiter } from '../types/class.js';
import type { LimiterLocalOptions } from '../types/config.js';
import { consume } from '../utils/consume.js';

/**
 * In-process rate limiter over `rate-limiter-flexible`'s memory store.
 *
 * Consumption is tracked per process, so with several processes each one enforces the limit on its own.
 *
 * @example
 * ```ts
 * const limiter = new LimiterLocal({ points: 10, duration: 5 });
 *
 * await limiter.consume(request.ip);
 * ```
 */
export class LimiterLocal implements Limiter {
	/**
	 * Underlying limiter doing the bookkeeping.
	 *
	 * @internal
	 */
	private limiter: RateLimiterMemory;

	/**
	 * Configured points per window, reported in the error when a key runs out.
	 *
	 * @internal
	 */
	private points: number;

	/**
	 * Create the limiter with its points and window.
	 *
	 * @param config - Local configuration.
	 */
	constructor(config: LimiterLocalOptions) {
		// 1. Hand the budget to the library and remember the points for error reporting
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
		// 1. The shared handler translates the library's rejection into a `HitRateLimitError`
		return await consume(this.limiter, key, this.points);
	}

	/**
	 * Forget the tracked consumption of a key.
	 *
	 * @param key - IP address, URL path or any other string identifying the caller.
	 */
	async delete(key: string): Promise<void> {
		// 1. Delegate to the library
		await this.limiter.delete(key);
	}
}
