import type { Redis, RedisOptions } from 'ioredis';
import type { RedisConfig } from '../types/config.js';
import { createRedis } from './create-redis.js';

/**
 * Registry of named Redis servers — locations — and the one client each of them is reached through.
 *
 * The registration shape every subsystem of the kit shares, without the driver step: there is one client library,
 * so a location is registered with its connection alone, and the client opens on the location's first use, so a
 * process that never touches a server never connects to it. One connection per location is enough for every
 * consumer: the `@novastarter/memory` backends share it, and the bus duplicates it by itself for subscribing. The
 * application wires it at start-up through {@link useRedis}.
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
	 * Location configurations keyed by name, as registered.
	 *
	 * @internal
	 */
	private configs: Map<string, { config: RedisConfig; overrides: RedisOptions }> = new Map();

	/**
	 * Clients keyed by location name; a location appears here on its first use.
	 *
	 * @internal
	 */
	private clients: Map<string, Redis> = new Map();

	/**
	 * Register a named location: how its server is reached, for the client opened on first use.
	 *
	 * Registering a name twice replaces the configuration and drops the client opened from the earlier one; closing
	 * that client is the caller's business, since it may still be in use.
	 *
	 * @param name - Location identifier used later with {@link RedisManager.location}.
	 * @param config - Connection URL or ioredis options.
	 * @param overrides - ioredis options laid over `config`; see {@link createRedis}.
	 */
	registerLocation(name: string, config: RedisConfig, overrides: RedisOptions = {}): void {
		// 1. Only the configuration is kept: the client connects when the location is first asked for
		this.configs.set(name, { config, overrides });
		this.clients.delete(name);
	}

	/**
	 * Return the client of a registered location, opening it on the first call.
	 *
	 * @param name - Location identifier passed to {@link RedisManager.registerLocation}; `default` when omitted.
	 * @returns The client of that location; the same one on every later call.
	 * @throws Error when no location of that name is registered.
	 */
	location(name: string = 'default'): Redis {
		// 1. Serve the client opened earlier, so every consumer shares the one connection
		const existing = this.clients.get(name);

		if (existing) {
			return existing;
		}

		// 2. Fail loudly instead of returning `undefined`: a missing location is a configuration bug that deserves a
		//    clear message
		const registration = this.configs.get(name);

		if (!registration) {
			throw new Error(`Location "${name}" doesn't exist.`);
		}

		// 3. First use opens the connection and keeps it
		const redis = createRedis(registration.config, registration.overrides);
		this.clients.set(name, redis);

		return redis;
	}

	/**
	 * Whether a location of this name is registered.
	 *
	 * @param name - Location identifier.
	 * @returns `true` when {@link RedisManager.registerLocation} was called with that name.
	 */
	hasLocation(name: string): boolean {
		// 1. Registration is what counts, not whether the client was opened yet
		return this.configs.has(name);
	}

	/**
	 * Names of every registered location, in registration order.
	 *
	 * @returns The names.
	 */
	locationNames(): string[] {
		// 1. A copy, so a caller iterating while registering more locations never sees the map change under it
		return [...this.configs.keys()];
	}

	/**
	 * Close every client opened so far; the process is shutting down.
	 *
	 * @returns Once every connection has quit.
	 */
	async close(): Promise<void> {
		// 1. `quit` waits for pending replies, which is what a graceful shutdown wants; the clients are dropped so a
		//    stray call after closing reconnects rather than failing on a dead connection
		await Promise.all([...this.clients.values()].map((redis) => redis.quit()));
		this.clients.clear();
	}
}
