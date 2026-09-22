import type { RedisOptions } from 'ioredis';

/**
 * How a Redis server is reached: a connection URL (`redis://user:pass@host:6379/0`) or ioredis options.
 *
 * Values come straight from the application's configuration — `env['REDIS']` and the like. A URL is read with
 * ioredis's own parser, so every form ioredis accepts means the same here; what it carries can be overridden by the
 * options a consumer passes next to it.
 */
export type RedisConfig = string | RedisOptions;
