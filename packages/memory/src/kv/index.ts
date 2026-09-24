/**
 * Key-value store: the `KvDriver` contract, its `local` and `redis` drivers, the `KvManager` of their locations and the
 * `useKv` accessor of the process-wide one.
 */
export type { KvDriver } from './driver.js';
export { INCREMENT_SCRIPT, KvDriverLocal, KvDriverRedis, SET_MAX_SCRIPT } from './lib/drivers/index.js';
export type { ExtendedRedis, KvDriverLocalConfig, KvDriverRedisConfig } from './lib/drivers/index.js';
export { KvManager } from './lib/kv-manager.js';
export type { KvDrivers } from './lib/kv-manager.js';
export { useKv } from './lib/use-kv.js';
export type { Lock, MaybePromise } from './types.js';
