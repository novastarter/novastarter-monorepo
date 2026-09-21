import { type Singleton, singleton } from '@novastarter/utils';
import { RedisManager } from './redis-manager.js';

/**
 * Return the process-wide {@link RedisManager}, creating an empty one on first use.
 *
 * The application registers its locations on it at start-up; every later caller gets the same instance, so one
 * connection per location serves the whole process.
 *
 * @returns The same manager on every call; `useRedis.reset()` drops it, for tests.
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
export const useRedis: Singleton<RedisManager> = singleton(() => new RedisManager());
