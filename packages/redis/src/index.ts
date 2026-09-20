/**
 * Public entry point of `@novastarter/redis`.
 *
 * Named Redis servers — locations — registered once at start-up with their connection URL or ioredis options
 * (`useRedis().registerLocation`), and the one client each is reached through afterwards
 * (`useRedis().location`). `createRedis` opens an independent client for code that needs its own connection.
 */
export * from './lib/create-redis.js';
export * from './lib/redis-manager.js';
export * from './lib/use-redis.js';
export * from './types.js';
