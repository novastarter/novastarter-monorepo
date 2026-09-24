/**
 * Public entry point of `@novastarter/redis`.
 *
 * Named Redis servers — locations — registered once at start-up with their connection URL or ioredis options
 * (`useRedis().registerLocation`), and the one client each is reached through afterwards
 * (`useRedis().location`). `createRedis` opens an independent client for code that needs its own connection.
 */
export { createRedis } from './lib/create-redis.js';
export { RedisManager } from './lib/redis-manager.js';
export { useRedis } from './lib/use-redis.js';
export type { RedisConfig } from './types.js';
