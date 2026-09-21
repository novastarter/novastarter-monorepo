import { type Singleton, singleton } from '@novastarter/utils';
import { LimiterManager } from './limiter-manager.js';

/**
 * Return the process-wide {@link LimiterManager}, creating one with only the built-in drivers on first use.
 *
 * The application registers its locations on it at start-up; every later caller gets the same instance.
 *
 * @returns The same manager on every call; `useLimiter.reset()` drops it, for tests.
 * @example
 * ```ts
 * useLimiter().registerLocation('api', {
 * 	driver: 'redis',
 * 	options: {
 * 		redis: useRedis().location('default'),
 * 		namespace: 'api',
 * 		points: 50,
 * 		duration: 1,
 * 	},
 * });
 *
 * await useLimiter().location('api').consume(request.ip);
 * ```
 */
export const useLimiter: Singleton<LimiterManager> = singleton(() => new LimiterManager());
