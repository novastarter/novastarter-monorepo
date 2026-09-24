/**
 * Cache: the `CacheDriver` contract, its `local`, `redis` and `multi` drivers, the `CacheManager` of their locations
 * and the `useCache` accessor of the process-wide one.
 */
export type { CacheDriver } from './driver.js';
export { CacheManager } from './lib/cache-manager.js';
export type { CacheDrivers } from './lib/cache-manager.js';
export { CACHE_CHANNEL_KEY, CacheDriverLocal, CacheDriverMulti, CacheDriverRedis } from './lib/drivers/index.js';
export type {
	CacheDriverLocalConfig,
	CacheDriverMultiConfig,
	CacheDriverRedisConfig,
	CacheMultiMessageClear,
} from './lib/drivers/index.js';
export { useCache } from './lib/use-cache.js';
