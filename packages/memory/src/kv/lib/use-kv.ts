import { type Singleton, singleton } from '@novastarter/utils';
import { KvManager } from './kv-manager.js';

/**
 * Return the process-wide {@link KvManager}, creating one with only the built-in drivers on first use.
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
