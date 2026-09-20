/**
 * Public entry point of `@novastarter/redis`.
 *
 * One ioredis client per location and process (`useRedis`), built from the `REDIS_*` environment variables
 * (`createRedis`), and the check the rest of the stack uses to decide between its Redis and in-memory backends
 * (`redisConfigAvailable`). Locations follow the storage convention: the default one lives under `REDIS_*`, the ones
 * listed in `REDIS_LOCATIONS` under `REDIS_<NAME>_*`.
 */
export * from './constants/locations.js';
export * from './lib/create-redis.js';
export * from './lib/use-redis.js';
export * from './utils/get-redis-locations.js';
export * from './utils/get-redis-prefix.js';
export * from './utils/redis-config-available.js';
