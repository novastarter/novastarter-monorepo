import type { CacheConfig } from '../types/config.js';
import { CacheLocal } from './local.js';
import { CacheMulti } from './multi.js';
import { CacheRedis } from './redis.js';

/**
 * Create the cache implementation matching the configuration's `type`.
 *
 * @param config - Local, Redis or multi-stage configuration.
 * @returns A ready-to-use cache.
 * @throws `Error` when `type` is not a known backend.
 * @example
 * ```ts
 * const cache = createCache({ type: 'local', maxKeys: 500 });
 *
 * await cache.set('my-key', 'my-value');
 * ```
 */
export const createCache = (config: CacheConfig): CacheLocal | CacheRedis | CacheMulti => {
	// 1. Pick the backend by the discriminant
	if (config.type === 'local') {
		return new CacheLocal(config);
	}

	if (config.type === 'redis') {
		return new CacheRedis(config);
	}

	if (config.type === 'multi') {
		return new CacheMulti(config);
	}

	// 2. Reject unknown types loudly instead of silently falling back to memory
	throw new Error(`Invalid Cache configuration: Type does not exist.`);
};
