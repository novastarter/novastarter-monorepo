import { type Singleton, singleton } from '@novastarter/utils';
import { BusManager } from '../bus/lib/manager.js';
import { CacheManager } from '../cache/lib/manager.js';
import { KvManager } from '../kv/lib/manager.js';
import { LimiterManager } from '../limiter/lib/manager.js';

/**
 * Return the process-wide {@link KvManager}, creating an empty one on first use.
 *
 * The application registers its locations on it at start-up; every later caller gets the same instance.
 *
 * @returns The same manager on every call; `useKv.reset()` drops it, for tests.
 * @example
 * ```ts
 * useKv().registerLocation('default', {
 * 	driver: 'redis',
 * 	options: {
 * 		redis: useRedis().location('default'),
 * 		namespace: 'kv',
 * 	},
 * });
 *
 * await useKv().location('default').set('key', 'value');
 * ```
 */
export const useKv: Singleton<KvManager> = singleton(() => new KvManager());

/**
 * Return the process-wide {@link CacheManager}, creating an empty one on first use.
 *
 * @returns The same manager on every call; `useCache.reset()` drops it, for tests.
 */
export const useCache: Singleton<CacheManager> = singleton(() => new CacheManager());

/**
 * Return the process-wide {@link BusManager}, creating an empty one on first use.
 *
 * @returns The same manager on every call; `useBus.reset()` drops it, for tests.
 */
export const useBus: Singleton<BusManager> = singleton(() => new BusManager());

/**
 * Return the process-wide {@link LimiterManager}, creating an empty one on first use.
 *
 * @returns The same manager on every call; `useLimiter.reset()` drops it, for tests.
 */
export const useLimiter: Singleton<LimiterManager> = singleton(() => new LimiterManager());
