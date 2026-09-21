/**
 * Name of the location every manager answers with when {@link LocationManager.location} is called without one — the
 * one a deployment with a single server, bucket or provider registers.
 *
 * @defaultValue `default`
 */
export const DEFAULT_LOCATION = 'default';

/**
 * Registry of named instances — locations — built from their configuration on first use.
 *
 * The part every manager of the kit shares, whether or not it has a driver step: a location is registered as the
 * arguments it will be built from, built on its first {@link LocationManager.location} call rather than at
 * registration, so a process that never touches a location never opens its connections, and kept for every later
 * caller, so the connections it holds are shared. A subclass says how a location is built
 * ({@link LocationManager.build}) and how a built one lets go of what it holds ({@link LocationManager.release});
 * {@link LocationManager.close} runs the latter over every built location at shutdown. `location()` without a name
 * answers with {@link DEFAULT_LOCATION}, so a deployment with one location of a kind reads the same everywhere.
 * `DriverManager` adds the driver step on top; `RedisManager` builds clients of one library straight from their
 * connection.
 *
 * @typeParam Instance - What a location builds; what {@link LocationManager.location} hands out.
 * @typeParam Config - The arguments of {@link LocationManager.registerLocation} after the name, as a tuple, so a
 * subclass keeps its own registration signature.
 * @example
 * ```ts
 * class RedisManager extends LocationManager<Redis, [config: RedisConfig]> {
 * 	protected build(config: RedisConfig): Redis {
 * 		return createRedis(config);
 * 	}
 *
 * 	protected async release(redis: Redis): Promise<void> {
 * 		await redis.quit();
 * 	}
 * }
 * ```
 */
export abstract class LocationManager<Instance, Config extends unknown[]> {
	/**
	 * Location configurations keyed by location name, as registered.
	 *
	 * @internal
	 */
	private configs: Map<string, Config> = new Map();

	/**
	 * Built instances keyed by location name; a location appears here on its first use.
	 *
	 * @internal
	 */
	private instances: Map<string, Instance> = new Map();

	/**
	 * Register a named location: what to build its instance from, on first use.
	 *
	 * Registering a name twice replaces the configuration and drops the instance built from the earlier one, so the
	 * next use builds afresh; closing the earlier instance is the caller's business, since it may still be in use.
	 *
	 * @param name - Location identifier used later with {@link LocationManager.location}.
	 * @param config - What {@link LocationManager.build} receives when the location is first asked for.
	 */
	registerLocation(name: string, ...config: Config): void {
		// 1. Only the configuration is kept: the instance is built when the location is first asked for
		this.configs.set(name, config);
		this.instances.delete(name);
	}

	/**
	 * Return the instance behind a registered location, building it on the first call.
	 *
	 * @param name - Location identifier passed to {@link LocationManager.registerLocation}; {@link DEFAULT_LOCATION}
	 * when omitted.
	 * @returns The instance bound to that location; the same one on every later call.
	 * @throws Error when no location of that name is registered.
	 */
	location(name: string = DEFAULT_LOCATION): Instance {
		// 1. Serve the instance built earlier, so every consumer shares the connections it holds
		const existing = this.instances.get(name);

		if (existing) {
			return existing;
		}

		// 2. Fail loudly instead of returning `undefined`: callers chain calls on the result, and a missing location
		//    is a configuration bug that deserves a clear message
		const config = this.configs.get(name);

		if (!config) {
			throw new Error(`Location "${name}" doesn't exist.`);
		}

		// 3. First use builds the instance and keeps it
		const instance = this.build(...config);
		this.instances.set(name, instance);

		return instance;
	}

	/**
	 * Whether a location of this name is registered.
	 *
	 * @param name - Location identifier.
	 * @returns `true` when {@link LocationManager.registerLocation} was called with that name.
	 */
	hasLocation(name: string): boolean {
		// 1. Registration is what counts, not whether the instance was built yet
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
	 * The instances built so far, keyed by location name — what a shutdown has to close.
	 *
	 * Locations never asked for have no instance and nothing to release.
	 *
	 * @returns The built instances, in order of first use.
	 */
	instantiated(): Map<string, Instance> {
		// 1. A copy, so closing an instance and dropping it cannot disturb a caller still iterating
		return new Map(this.instances);
	}

	/**
	 * Release every instance built so far; the process is shutting down.
	 *
	 * The registrations stay: a location asked for after closing is built afresh rather than answered with a closed
	 * instance.
	 *
	 * @returns Once every instance let go of what it held.
	 */
	async close(): Promise<void> {
		// 1. Only the instances built so far hold anything; they release in parallel, each its own connections
		await Promise.all([...this.instances.values()].map((instance) => this.release(instance)));

		// 2. Dropped rather than kept, so a stray call after closing rebuilds instead of failing on a dead instance
		this.instances.clear();
	}

	/**
	 * Build the instance of a location from what it was registered with.
	 *
	 * @param config - The arguments given to {@link LocationManager.registerLocation} after the name.
	 * @returns The instance {@link LocationManager.location} hands out from now on.
	 */
	protected abstract build(...config: Config): Instance;

	/**
	 * Let a built instance go of what it holds — connections, timers — at shutdown.
	 *
	 * @param instance - An instance built by {@link LocationManager.build}.
	 * @returns Once the instance released everything.
	 */
	protected abstract release(instance: Instance): Promise<void>;
}
