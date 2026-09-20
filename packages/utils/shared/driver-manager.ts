/**
 * Constructor of a driver: one class per backend, instantiated once per location with that location's options.
 *
 * The parameter is typed `never` on purpose: every driver of a manager takes its own options shape, narrower than
 * the manager's union, and `never` is the one parameter type every constructor is assignable to. What a location
 * passes is checked on {@link LocationConfig.options} instead.
 *
 * @typeParam Instance - What the driver builds.
 */
export type DriverClass<Instance> = new (options: never) => Instance;

/**
 * One entry of {@link DriverManager.registerLocation}: which driver and what to hand its constructor.
 *
 * @typeParam Options - What the driver constructor takes.
 */
export interface LocationConfig<Options> {
	/** Name the driver was registered under. */
	driver: string;
	/** Options forwarded verbatim to the driver constructor. */
	options: Options;
}

/**
 * Name of the location that answers for every name nobody registered.
 *
 * @defaultValue `default`
 */
export const DEFAULT_LOCATION = 'default';

/**
 * Registry of driver classes and of the named instances — locations — built from them.
 *
 * The one registration shape every subsystem of the kit shares: storage, queues, key-value stores and so on all
 * expose a manager of this class, so an application wires each of them the same way at start-up — drivers as
 * classes, locations as explicit options read from its own configuration. Nothing is read from the environment here.
 * A driver is instantiated once per location, so one class (S3, say) can back several locations with different
 * credentials. Order matters: a location can only be registered once its driver is.
 *
 * A location registered under {@link DEFAULT_LOCATION} answers {@link DriverManager.location} for every name that
 * has no location of its own, so a subsystem that keys locations by a runtime name — a queue by its job's queue —
 * needs one registration for the common case.
 *
 * @typeParam Instance - What a driver builds; what {@link DriverManager.location} hands out.
 * @typeParam Options - What a driver constructor takes.
 * @example
 * ```ts
 * const storage = new DriverManager<Driver, DriverOptions>();
 *
 * storage.registerDriver('s3', DriverS3);
 * storage.registerLocation('uploads', { driver: 's3', options: { bucket: 'uploads' } });
 *
 * await storage.location('uploads').write('avatar.png', stream, 'image/png');
 * ```
 */
export class DriverManager<Instance, Options = Record<string, unknown>> {
	/**
	 * Driver classes keyed by the name they were registered under.
	 *
	 * @internal
	 */
	private drivers: Map<string, DriverClass<Instance>> = new Map();

	/**
	 * Instantiated drivers keyed by location name.
	 *
	 * @internal
	 */
	private locations: Map<string, Instance> = new Map();

	/**
	 * Make a driver class available under a name for locations to reference.
	 *
	 * Registering a name twice replaces the earlier class; locations created before the replacement keep their
	 * existing instance.
	 *
	 * @param name - Identifier used in {@link LocationConfig.driver}.
	 * @param driver - Driver class.
	 */
	registerDriver(name: string, driver: DriverClass<Instance>): void {
		// 1. A plain Map write is enough: a duplicate name replaces the earlier class, as the JSDoc promises
		this.drivers.set(name, driver);
	}

	/**
	 * Create a driver instance for a named location.
	 *
	 * @param name - Location identifier used later with {@link DriverManager.location}.
	 * @param config - Which driver to use and the options passed to its constructor.
	 * @throws Error when `config.driver` names a driver that has not been registered.
	 */
	registerLocation(name: string, config: LocationConfig<Options>): void {
		// 1. Resolve the driver class up front, so a typo in the config fails at registration rather than on first use
		const Driver = this.drivers.get(config.driver);

		if (!Driver) {
			throw new Error(`Driver "${config.driver}" isn't registered.`);
		}

		// 2. Instantiate eagerly: drivers set up their clients in the constructor, and doing that once per location
		//    shares connections across every call made through that location
		this.locations.set(name, new Driver(config.options as never));
	}

	/**
	 * Return the driver instance behind a registered location.
	 *
	 * @param name - Location identifier passed to {@link DriverManager.registerLocation}.
	 * @returns The driver bound to that location, or to {@link DEFAULT_LOCATION} when the name has none of its own.
	 * @throws Error when neither the location nor a default one exists.
	 */
	location(name: string): Instance {
		// 1. The name's own location wins; the default one covers the names nobody registered
		const driver = this.locations.get(name) ?? this.locations.get(DEFAULT_LOCATION);

		// 2. Fail loudly instead of returning `undefined`: callers chain calls on the result, and a missing location
		//    is a configuration bug that deserves a clear message
		if (!driver) {
			throw new Error(`Location "${name}" doesn't exist.`);
		}

		return driver;
	}

	/**
	 * Whether a location of exactly this name is registered; the default location does not count.
	 *
	 * @param name - Location identifier.
	 * @returns `true` when {@link DriverManager.registerLocation} was called with that name.
	 */
	hasLocation(name: string): boolean {
		// 1. Exact membership only: the default fallback of `location()` would make every name look registered
		return this.locations.has(name);
	}

	/**
	 * Names of every registered location, in registration order.
	 *
	 * @returns The names, the default location included when it is registered.
	 */
	locationNames(): string[] {
		// 1. A copy, so a caller iterating while registering more locations never sees the map change under it
		return [...this.locations.keys()];
	}
}
