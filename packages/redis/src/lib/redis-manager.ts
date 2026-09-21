import { LocationManager } from '@novastarter/utils';
import type { Redis, RedisOptions } from 'ioredis';
import type { RedisConfig } from '../types.js';
import { createRedis } from './create-redis.js';

/**
 * Registry of named Redis servers — locations — and the one client each of them is reached through.
 *
 * The {@link LocationManager} of the kit for Redis, without the driver step: there is one client library, so a
 * location is registered with its connection alone, and the client opens on the location's first use, so a process
 * that never touches a server never connects to it. One connection per location is enough for every consumer: the
 * `@novastarter/memory` backends share it, and the bus duplicates it by itself for subscribing. `location()` without
 * a name answers with the `default` location, the one server most deployments have; `close()` quits every client
 * opened so far. The application wires it at start-up through {@link useRedis}.
 *
 * @example
 * ```ts
 * const redis = new RedisManager();
 *
 * redis.registerLocation('default', 'redis://cache:6379');
 * redis.registerLocation('jobs', {
 * 	host: 'jobs.internal',
 * 	port: 6379,
 * 	password: '…',
 * });
 *
 * await redis.location('jobs').ping();
 * ```
 */
export class RedisManager extends LocationManager<Redis, [config: RedisConfig, overrides?: RedisOptions]> {
	/**
	 * Open the client of a location from the connection it was registered with.
	 *
	 * @param config - Connection URL or ioredis options.
	 * @param overrides - ioredis options laid over `config`; see {@link createRedis}.
	 * @returns A connecting client.
	 */
	protected build(config: RedisConfig, overrides: RedisOptions = {}): Redis {
		// 1. `createRedis` is the one place a client is opened, so a location's client is set up like any other
		return createRedis(config, overrides);
	}

	/**
	 * Quit a client opened by {@link RedisManager.build}.
	 *
	 * @param redis - The client of a location.
	 * @returns Once the server acknowledged the quit.
	 */
	protected async release(redis: Redis): Promise<void> {
		// 1. `quit` waits for pending replies, which is what a graceful shutdown wants
		await redis.quit();
	}
}
