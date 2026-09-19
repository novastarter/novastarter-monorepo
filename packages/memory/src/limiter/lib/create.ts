import type { LimiterConfig } from '../types/config.js';
import { LimiterLocal } from './local.js';
import { LimiterRedis } from './redis.js';

/**
 * Create the limiter implementation matching the configuration's `type`.
 *
 * @param config - Local or Redis configuration.
 * @returns A ready-to-use limiter.
 * @throws `Error` when `type` is not a known backend.
 * @example
 * ```ts
 * const limiter = createLimiter({ type: 'local', points: 10, duration: 5 });
 *
 * await limiter.consume(request.ip);
 * ```
 */
export const createLimiter = (config: LimiterConfig): LimiterLocal | LimiterRedis => {
	// 1. Pick the backend by the discriminant
	if (config.type === 'local') {
		return new LimiterLocal(config);
	}

	if (config.type === 'redis') {
		return new LimiterRedis(config);
	}

	// 2. Reject unknown types loudly instead of silently falling back to memory
	throw new Error(`Invalid Limiter configuration: Type does not exist.`);
};
