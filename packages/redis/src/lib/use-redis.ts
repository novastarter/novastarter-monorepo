import { RedisManager } from './redis-manager.js';

/**
 * Holder for the manager built on first use.
 *
 * Wrapped in an object rather than exported as a bare binding, so tests can reset it in place instead of reloading
 * the module; application code goes through {@link useRedis}.
 *
 * @internal
 */
export const _cache: { redis: RedisManager | undefined } = { redis: undefined };

/**
 * Return the process-wide {@link RedisManager}, creating an empty one on first use.
 *
 * The application registers its locations on it at start-up; every later caller gets the same instance, so one
 * connection per location serves the whole process.
 *
 * @returns The same manager on every call.
 * @example
 * ```ts
 * // at start-up
 * useRedis().registerLocation('default', env['REDIS'] as string);
 *
 * // anywhere later
 * useCache().registerLocation('default', {
 * 	driver: 'redis',
 * 	options: {
 * 		redis: useRedis().location('default'),
 * 		namespace: 'app',
 * 	},
 * });
 * ```
 */
export const useRedis = (): RedisManager => {
	// 1. One manager per process: a second one would open a second connection per location
	if (_cache.redis) {
		return _cache.redis;
	}

	_cache.redis = new RedisManager();

	return _cache.redis;
};
