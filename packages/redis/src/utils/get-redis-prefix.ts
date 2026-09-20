import { DEFAULT_REDIS_LOCATION } from '../constants/locations.js';

/**
 * Return the environment variable prefix of a location.
 *
 * The default location keeps the plain `REDIS` family, so a single-server setup needs no location name at all. Every
 * other location nests under it: `queue` becomes `REDIS_QUEUE`, so `REDIS_QUEUE` is its URL and `REDIS_QUEUE_HOST`
 * one of its split variables, the same way storage locations use `STORAGE_<NAME>_*`.
 *
 * @param name - Location name as used with `useRedis`.
 * @returns The prefix without the trailing underscore.
 * @example
 * ```ts
 * getRedisPrefix('default'); // 'REDIS'
 * getRedisPrefix('queue'); // 'REDIS_QUEUE'
 * ```
 */
export const getRedisPrefix = (name: string): string => {
	// 1. The default family has no name segment, so existing single-server configs keep working unchanged
	if (name === DEFAULT_REDIS_LOCATION) {
		return 'REDIS';
	}

	// 2. Named locations are upper-cased into the variable name
	return `REDIS_${name.toUpperCase()}`;
};
