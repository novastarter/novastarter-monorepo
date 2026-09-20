import { DEFAULT_LOCATION } from '@novastarter/utils';
import type { Redis, RedisOptions } from 'ioredis';
import type { RedisConfig } from '../types/config.js';
import { createRedis } from './create-redis.js';

/**
 * Registry of named Redis servers — locations — and the one client each of them is reached through.
 *
 * The registration shape every subsystem of the kit shares, without the driver step: there is one client library,
 * so a location is registered with its connection alone. One connection per location is enough for every consumer:
 * the `@novastarter/memory` backends share it, and the bus duplicates it by itself for subscribing. A location named
 * `default` answers {@link RedisManager.location} for every name nobody registered. The application wires it at
 * start-up through {@link useRedis}.
 *
 * @example
 * ```ts
 * const redis = new RedisManager();
 *
 * redis.registerLocation('default', 'redis://cache:6379');
 * redis.registerLocation('jobs', { host: 'jobs.internal', port: 6379, password: '…' });
 *
 * await redis.location('jobs').ping();
 * ```
 */
export class RedisManager {
	/**
	 * Clients keyed by location name.
	 *
	 * @internal
	 */
	private locations: Map<string, Redis> = new Map();

	/**
	 * Open the client of a named location.
	 *
	 * Registering a name twice replaces the client; the earlier one is left to the caller to close, since it may
	 * still be in use.
	 *
	 * @param name - Location identifier used later with {@link RedisManager.location}.
	 * @param config - Connection URL or ioredis options.
	 * @param overrides - ioredis options laid over `config`; see {@link createRedis}.
	 */
	registerLocation(name: string, config: RedisConfig, overrides: RedisOptions = {}): void {
		// 1. Connect eagerly, so a wrong address fails at start-up rather than on the first command
		this.locations.set(name, createRedis(config, overrides));
	}

	/**
	 * Return the client of a registered location.
	 *
	 * @param name - Location identifier passed to {@link RedisManager.registerLocation}.
	 * @returns The client of that location, or of `default` when the name has none of its own.
	 * @throws Error when neither the location nor a default one exists.
	 */
	location(name: string = DEFAULT_LOCATION): Redis {
		// 1. The name's own location wins; the default one covers the names nobody registered
		const redis = this.locations.get(name) ?? this.locations.get(DEFAULT_LOCATION);

		// 2. Fail loudly instead of returning `undefined`: a missing location is a configuration bug that deserves a
		//    clear message
		if (!redis) {
			throw new Error(`Location "${name}" doesn't exist.`);
		}

		return redis;
	}

	/**
	 * Whether a location of exactly this name is registered; the default location does not count.
	 *
	 * @param name - Location identifier.
	 * @returns `true` when {@link RedisManager.registerLocation} was called with that name.
	 */
	hasLocation(name: string): boolean {
		// 1. Exact membership only: the default fallback of `location()` would make every name look registered
		return this.locations.has(name);
	}

	/**
	 * Names of every registered location, in registration order.
	 *
	 * @returns The names.
	 */
	locationNames(): string[] {
		// 1. A copy, so a caller iterating while registering more locations never sees the map change under it
		return [...this.locations.keys()];
	}

	/**
	 * Close every client; the process is shutting down.
	 *
	 * @returns Once every connection has quit.
	 */
	async close(): Promise<void> {
		// 1. `quit` waits for pending replies, which is what a graceful shutdown wants; the map is emptied so a
		//    stray call after closing fails with "doesn't exist" rather than on a dead connection
		await Promise.all([...this.locations.values()].map((redis) => redis.quit()));
		this.locations.clear();
	}
}
