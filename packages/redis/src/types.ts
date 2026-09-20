import type { RedisOptions } from 'ioredis';

/**
 * How a Redis server is reached: a connection URL (`redis://user:pass@host:6379/0`) or ioredis options.
 *
 * Values come straight from the application's configuration — `env['REDIS']` and the like — and are passed to
 * ioredis as they are.
 */
export type RedisConfig = string | RedisOptions;
