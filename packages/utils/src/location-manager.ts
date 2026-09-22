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
	 * The `close()` under way, while one is, so a second call joins it instead of releasing the same instances again.
	 *
	 * @internal
	 */
	private closing: Promise<void> | undefined;

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
		// 1. Serve the instance built earlier, so every consumer shares the connections it holds. Presence is checked
		//    with `has`, not by truthiness: a driver that builds to `0`, `''` or `false` is an instance all the same
		if (this.instances.has(name)) {
			return this.instances.get(name) as Instance;
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
	 * Every instance is released, whether or not another one fails to: a shutdown must not leave a connection open
	 * because a different one refused to close. The registrations stay, and the instances leave the registry before
	 * their release starts: a location asked for after closing, or while the releases are still running, is built
	 * afresh rather than answered with a closed or closing instance, and such an instance is kept for the next
	 * `close()`. A `close()` that overlaps another waits for it rather than releasing the same instances twice, then
	 * releases what was built meanwhile: every instance in the release snapshot of a `close()` call — everything
	 * built before the run starts — is released by that call, while an instance built during the run is kept for
	 * the next one.
	 *
	 * @returns Once every instance let go of what it held.
	 * @throws What the one failing {@link LocationManager.release} threw, or an `AggregateError` of all of them when
	 * several failed — after every instance was released and dropped, so a later `close()` releases nothing twice.
	 */
	async close(): Promise<void> {
		// 1. A release run under way is waited for, never doubled: releasing an instance twice — a second `quit()` on
		//    a client — would fail. Its failure is kept for the end, so this caller learns of it too
		let joined: { error: unknown } | undefined;

		if (this.closing) {
			try {
				await this.closing;
			} catch (error) {
				joined = { error };
			}
		}

		// 2. A run of this call's own, for whatever the registry holds now — nothing, most of the time, or the
		//    instances a `location()` built while the joined run was releasing. The field is cleared once it settles,
		//    so a later `close()` starts afresh
		this.closing ??= this.releaseAll().finally(() => {
			this.closing = undefined;
		});

		let own: { error: unknown } | undefined;

		try {
			await this.closing;
		} catch (error) {
			own = { error };
		}

		// 3. The failures come out after every release is done, so nothing stays open because of them: the one as it
		//    came, both together when the joined run and this call's own run failed
		if (joined && own) {
			throw new AggregateError([joined.error, own.error], 'Two close runs failed');
		}

		if (joined ?? own) {
			throw (joined ?? own)?.error;
		}
	}

	/**
	 * Take every built instance out of the registry and release them all, reporting the failures at the end.
	 *
	 * @returns Once every instance let go of what it held.
	 * @throws See {@link LocationManager.close}.
	 * @internal
	 */
	private async releaseAll(): Promise<void> {
		// 1. Out of the registry before the first release starts, so a `location()` during the run builds a fresh
		//    instance instead of being handed one that is about to be closed under it; what it builds stays for the
		//    next `close()`
		const released = [...this.instances.values()];
		this.instances.clear();

		// 2. Only the instances built so far hold anything; they release in parallel, each its own connections, and
		//    every outcome is waited for, so one failure does not abandon the releases still running. Each release
		//    starts inside an async function, so a `release()` that throws before returning a promise is a rejection
		//    like any other rather than an exception that would stop the others from being started
		const outcomes = await Promise.allSettled(released.map(async (instance) => await this.release(instance)));

		// 3. Report the failures once nothing is left open: the one error as it came, several as an `AggregateError`
		const failures = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);

		if (failures.length === 1) {
			throw failures[0];
		}

		if (failures.length > 1) {
			throw new AggregateError(failures, `${failures.length} of ${outcomes.length} locations failed to close`);
		}
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
