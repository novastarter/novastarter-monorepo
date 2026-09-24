/**
 * Public entry point of `@novastarter/memory`.
 *
 * Four ephemeral-storage abstractions share one package because they share the same backends (local memory and
 * Redis) and the same serialization helpers: `KvDriver` (key-value store), `CacheDriver` (the same store without
 * the numeric helpers, always asynchronous, with an LRU and a multi-process mode), `BusDriver` (pub/sub) and
 * `LimiterDriver` (points-per-duration rate limiter). Each is reached through a manager of named locations
 * (`useKv().registerLocation` / `.location`) the application wires at start-up; the driver classes (`KvDriverLocal`,
 * `KvDriverRedis`, …) are exported for code that needs a standalone instance.
 */
export { BusDriverLocal, BusDriverRedis, BusManager, useBus } from './bus/index.js';
export type { BusDriver, BusDriverLocalConfig, BusDriverRedisConfig, BusDrivers, MessageHandler } from './bus/index.js';
export {
	CACHE_CHANNEL_KEY,
	CacheDriverLocal,
	CacheDriverMulti,
	CacheDriverRedis,
	CacheManager,
	useCache,
} from './cache/index.js';
export type {
	CacheDriver,
	CacheDriverLocalConfig,
	CacheDriverMultiConfig,
	CacheDriverRedisConfig,
	CacheDrivers,
	CacheMultiMessageClear,
} from './cache/index.js';
export { INCREMENT_SCRIPT, KvDriverLocal, KvDriverRedis, KvManager, SET_MAX_SCRIPT, useKv } from './kv/index.js';
export type {
	ExtendedRedis,
	KvDriver,
	KvDriverLocalConfig,
	KvDriverRedisConfig,
	KvDrivers,
	Lock,
	MaybePromise,
} from './kv/index.js';
export { LimiterDriverLocal, LimiterDriverRedis, LimiterManager, useLimiter } from './limiter/index.js';
export type {
	LimiterDriver,
	LimiterDriverConfigBase,
	LimiterDriverLocalConfig,
	LimiterDriverRedisConfig,
	LimiterDrivers,
} from './limiter/index.js';
