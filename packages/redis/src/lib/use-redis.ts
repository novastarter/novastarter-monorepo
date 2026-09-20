import type { Redis } from 'ioredis';
import { DEFAULT_REDIS_LOCATION } from '../constants/locations.js';
import { createRedis } from './create-redis.js';

/**
 * Holder for the clients built on first use, keyed by location name.
 *
 * Wrapped in an object rather than exported as a bare binding, so tests can reset it in place instead of reloading
 * the module; application code goes through {@link useRedis}.
 *
 * @internal
 * @defaultValue Empty until first use.
 */
export const _cache: {
	redis: Map<string, Redis>;
} = { redis: new Map() };

/**
 * Return the process-wide ioredis client of a location, building it on the first call.
 *
 * One connection per location is enough for every consumer: the `@novastarter/memory` backends share it, and the bus
 * duplicates it by itself for subscribing. Opening a client per consumer would multiply connections for nothing.
 *
 * @param name - Location name; the default location when omitted.
 * @returns The same client on every call with the same name, so callers may hold on to it.
 * @example
 * ```ts
 * const cache = createCache({ type: 'redis', redis: useRedis(), namespace: 'app' });
 * const limiter = createLimiter({ type: 'redis', redis: useRedis('queue'), namespace: 'app', points: 10, duration: 5 });
 * ```
 */
export const useRedis = (name: string = DEFAULT_REDIS_LOCATION): Redis => {
	// 1. Serve the cached client of this location as long as it exists
	const cached = _cache.redis.get(name);

	if (cached) {
		return cached;
	}

	// 2. First call for this name: build from the environment and remember
	const redis = createRedis(name);
	_cache.redis.set(name, redis);

	return redis;
};
