/**
 * Constructor of a driver: one class per backend, instantiated once per location with that location's options.
 *
 * The parameter is typed `never` on purpose: every driver of a manager takes its own options shape, and `never` is
 * the one parameter type every constructor is assignable to. What a location passes is checked against the driver
 * map of the manager on {@link LocationConfig} instead.
 *
 * @typeParam Instance - What the driver builds.
 */
export type DriverClass<Instance> = new (options: never) => Instance;

/**
 * One entry of {@link DriverManager.registerLocation}: which driver and what to hand its constructor.
 *
 * A discriminated union over the driver map, so `driver` decides the type of `options`: with
 * `{ local: LocalOptions; bullmq: BullmqOptions }`, `{ driver: 'bullmq', options }` only compiles with
 * `BullmqOptions`.
 *
 * @typeParam Drivers - Driver names mapped to the options their constructor takes.
 */
export type LocationConfig<Drivers extends object> = {
	[Name in keyof Drivers & string]: {
		/** Name the driver was registered under. */
		driver: Name;
		/** Options forwarded verbatim to the driver constructor, on first use of the location. */
		options: Drivers[Name];
	};
}[keyof Drivers & string];

/**
 * Registry of driver classes and of the named instances — locations — built from them.
 *
 * The one registration shape every subsystem of the kit shares: storage, queues, key-value stores and so on all
 * expose a manager of this class, so an application wires each of them the same way at start-up — drivers as
 * classes, locations as explicit options read from its own configuration. Nothing is read from the environment here.
 * A location is instantiated on its first {@link DriverManager.location} call, not at registration, so a process that
 * never touches a location never opens its connections — what a serverless cold start wants — and a driver is
 * instantiated once per location, so one class (S3, say) can back several locations with different credentials.
 * Order matters: a location can only be registered once its driver is.
 *
 * `Drivers` maps the driver names to their options, so a location's `options` are checked against the driver it
 * names. Each subsystem declares its map as an augmentable interface, so a driver package or an application can add
 * its own driver to the map with `declare module`.
 *
 * @typeParam Instance - What a driver builds; what {@link DriverManager.location} hands out.
 * @typeParam Drivers - Driver names mapped to the options their constructor takes.
 * @example
 * ```ts
 * const storage = new DriverManager<Driver, { s3: DriverS3Config; local: DriverLocalConfig }>();
 *
 * storage.registerDriver('s3', DriverS3);
 * storage.registerLocation('uploads', { driver: 's3', options: { bucket: 'uploads' } });
 *
 * await storage.location('uploads').write('avatar.png', stream, 'image/png');
 * ```
 */
export class DriverManager<Instance, Drivers extends object = Record<string, unknown>> {
	/**
	 * Driver classes keyed by the name they were registered under.
	 *
	 * @internal
	 */
	private drivers: Map<string, DriverClass<Instance>> = new Map();

	/**
	 * Location configurations keyed by location name, as registered.
	 *
	 * @internal
	 */
	private configs: Map<string, LocationConfig<Drivers>> = new Map();

	/**
	 * Instantiated drivers keyed by location name; a location appears here on its first use.
	 *
	 * @internal
	 */
	private instances: Map<string, Instance> = new Map();

	/**
	 * Make a driver class available under a name for locations to reference.
	 *
	 * Registering a name twice replaces the earlier class; locations instantiated before the replacement keep their
	 * existing instance.
	 *
	 * @param name - Identifier used in {@link LocationConfig.driver}.
	 * @param driver - Driver class.
	 */
	registerDriver(name: keyof Drivers & string, driver: DriverClass<Instance>): void {
		// 1. A plain Map write is enough: a duplicate name replaces the earlier class, as the JSDoc promises
		this.drivers.set(name, driver);
	}

	/**
	 * Register a named location: which driver and which options, for the instance built on first use.
	 *
	 * Registering a name twice replaces the configuration and drops the instance built from the earlier one, so the
	 * next use builds afresh; closing the earlier instance is the caller's business, since it may still be in use.
	 *
	 * @param name - Location identifier used later with {@link DriverManager.location}.
	 * @param config - Which driver to use and the options passed to its constructor.
	 * @throws Error when `config.driver` names a driver that has not been registered.
	 */
	registerLocation(name: string, config: LocationConfig<Drivers>): void {
		// 1. Resolve the driver class up front, so a typo in the config fails at registration rather than on first use
		if (!this.drivers.has(config.driver)) {
			throw new Error(`Driver "${config.driver}" isn't registered.`);
		}

		// 2. Only the configuration is kept: the driver is built when the location is first asked for
		this.configs.set(name, config);
		this.instances.delete(name);
	}

	/**
	 * Return the driver instance behind a registered location, building it on the first call.
	 *
	 * @param name - Location identifier passed to {@link DriverManager.registerLocation}.
	 * @returns The driver bound to that location; the same instance on every later call.
	 * @throws Error when no location of that name is registered.
	 */
	location(name: string): Instance {
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

		// 3. The driver was checked at registration; it may have been replaced since, which is why it is looked up now
		const Driver = this.drivers.get(config.driver);

		if (!Driver) {
			throw new Error(`Driver "${config.driver}" isn't registered.`);
		}

		const instance = new Driver(config.options as never);
		this.instances.set(name, instance);

		return instance;
	}

	/**
	 * Whether a location of this name is registered.
	 *
	 * @param name - Location identifier.
	 * @returns `true` when {@link DriverManager.registerLocation} was called with that name.
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
}
