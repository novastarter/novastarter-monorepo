import { getConfigFromEnv, useEnv } from '@novastarter/env';
import { Redis } from 'ioredis';
import { DEFAULT_REDIS_LOCATION, NON_CLIENT_KEYS } from '../constants/locations.js';
import { getRedisLocations } from '../utils/get-redis-locations.js';
import { getRedisPrefix } from '../utils/get-redis-prefix.js';

/**
 * Create a new ioredis client for a location from the environment.
 *
 * A location is one server: the default one is configured by `REDIS` / `REDIS_*`, a named one by
 * `REDIS_<NAME>` / `REDIS_<NAME>_*` and must be listed in `REDIS_LOCATIONS`. Within a location the URL variable wins
 * when it is set; otherwise the split variables are collected into the ioredis options with
 * {@link getConfigFromEnv}: `_HOST`, `_PORT`, `_USERNAME`, `_PASSWORD`, `_DB` become `host`, `port`, `username`,
 * `password`, `db`, and a double underscore nests, so `REDIS_TLS__REJECT_UNAUTHORIZED=false` becomes
 * `{ tls: { rejectUnauthorized: false } }`.
 *
 * Every call opens a new connection; application code shares one per location through `useRedis`.
 *
 * @param name - Location name; the default location when omitted.
 * @returns A connecting ioredis client.
 * @example
 * ```ts
 * // REDIS=redis://localhost:6379
 * const redis = createRedis();
 *
 * // REDIS_LOCATIONS=queue, REDIS_QUEUE_HOST=queue.internal
 * const queue = createRedis('queue');
 * ```
 */
export const createRedis = (name: string = DEFAULT_REDIS_LOCATION): Redis => {
	const env = useEnv();
	const prefix = getRedisPrefix(name);

	// 1. A connection URL carries everything at once, so it takes precedence over the split variables
	if (prefix in env) {
		return new Redis(env[prefix] as string);
	}

	// 2. Named families nest under `REDIS_`, so the default client has to skip its siblings by prefix; the location's
	//    enable switch and the variables meant for other subsystems are skipped by name
	const omitPrefix = getRedisLocations()
		.filter((other) => other !== name)
		.map((other) => `${getRedisPrefix(other)}_`);

	const omitKey = [...NON_CLIENT_KEYS, `${prefix}_ENABLED`];

	// 3. The prefix keeps its underscore, so the bare URL key could never turn into an empty-named option
	const options = getConfigFromEnv(`${prefix}_`, { omitKey, omitPrefix });

	return new Redis(options);
};
