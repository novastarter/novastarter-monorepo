import { Redis, type RedisOptions } from 'ioredis';
import type { RedisConfig } from '../types/config.js';

/**
 * Open a new ioredis client.
 *
 * A connection URL carries everything at once; ioredis options are passed through as given. `overrides` are laid
 * over either, for a consumer that needs the client set up its own way — BullMQ, for one, requires
 * `maxRetriesPerRequest: null`. Every call opens a new connection; application code shares one per location through
 * {@link RedisManager}.
 *
 * @param config - Connection URL or ioredis options.
 * @param overrides - ioredis options that win over `config`.
 * @returns A connecting ioredis client.
 * @example
 * ```ts
 * const redis = createRedis('redis://localhost:6379');
 *
 * const queue = createRedis(
 * 	{
 * 		host: 'jobs.internal',
 * 		port: 6379,
 * 		password: '…',
 * 	},
 * 	{ maxRetriesPerRequest: null },
 * );
 * ```
 */
export const createRedis = (config: RedisConfig, overrides: RedisOptions = {}): Redis => {
	// 1. ioredis merges the options given next to a URL over the ones it parses out of it, so the overrides win either
	//    way
	if (typeof config === 'string') {
		return new Redis(config, overrides);
	}

	return new Redis({ ...config, ...overrides });
};
