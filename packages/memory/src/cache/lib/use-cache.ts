import { type Singleton, singleton } from '@novastarter/utils';
import { CacheManager } from './cache-manager.js';

/**
 * Return the process-wide {@link CacheManager}, creating one with only the built-in drivers on first use.
 *
 * The application registers its locations on it at start-up; every later caller gets the same instance.
 *
 * @returns The same manager on every call; `useCache.reset()` drops it, for tests.
 * @example
 * ```ts
 * useCache().registerLocation('default', {
 * 	driver: 'redis',
 * 	options: {
 * 		redis: useRedis().location('default'),
 * 		namespace: 'cache',
 * 		ttl: 60_000,
 * 	},
 * });
 *
 * await useCache().location('default').set('key', 'value');
 * ```
 */
export const useCache: Singleton<CacheManager> = singleton(() => new CacheManager());
