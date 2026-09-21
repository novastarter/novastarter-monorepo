import { type Singleton, singleton } from '@novastarter/utils';
import { BusManager } from './bus-manager.js';

/**
 * Return the process-wide {@link BusManager}, creating one with only the built-in drivers on first use.
 *
 * The application registers its locations on it at start-up; every later caller gets the same instance.
 *
 * @returns The same manager on every call; `useBus.reset()` drops it, for tests.
 * @example
 * ```ts
 * useBus().registerLocation('default', {
 * 	driver: 'redis',
 * 	options: {
 * 		redis: useRedis().location('default'),
 * 		namespace: 'bus',
 * 	},
 * });
 *
 * await useBus().location('default').publish('user.created', { id });
 * ```
 */
export const useBus: Singleton<BusManager> = singleton(() => new BusManager());
