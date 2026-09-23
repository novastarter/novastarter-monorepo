import { LocationManager } from './location-manager.js';

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
 * What every driver of a {@link DriverManager} may implement to be closed at shutdown.
 *
 * Optional on purpose: a driver that holds connections or timers — an SDK client, a subscription, a scheduler —
 * implements `close()` and the manager calls it; a driver that only makes HTTP requests has nothing to release and
 * leaves it out. Every driver contract of the kit declares it, so a manager can close its locations without knowing
 * which driver is behind each.
 */
export interface Closable {
	/**
	 * Release what the driver holds — connections, timers — so the process can exit.
	 *
	 * @returns Once everything is released.
	 */
	close?(): Promise<void>;
}

/**
 * What a location sets once for every `call()` of its driver: headers and a timeout.
 */
export interface CallDefaults {
	/** Headers every call sends — an API version, an account — under the call's own. */
	headers?: Record<string, string> | undefined;
	/** The timeout of every call, in milliseconds, unless the call names one. */
	timeout?: number | undefined;
}

/**
 * Merge a location's call defaults with a call's options: the call's headers over the defaults', its timeout first.
 *
 * @param defaults - The location's defaults.
 * @param options - The call's options.
 * @returns The options the driver gets.
 * @example
 * ```ts
 * mergeCallOptions({ headers: { 'x-version': '1' }, timeout: 5_000 }, { headers: { 'x-trace': 'a' } });
 * // { headers: { 'x-version': '1', 'x-trace': 'a' }, timeout: 5_000 }
 * ```
 */
export const mergeCallOptions = <O extends CallDefaults & { headers?: Record<string, string> | undefined }>(
	defaults: CallDefaults | undefined,
	options?: O,
): O => {
	// 1. Nothing set on the location: the call's options as they are
	if (!defaults) {
		return (options ?? {}) as O;
	}

	// 2. The call wins where both say something; a header name is compared case-insensitively, so the call's
	//    `Content-Type` replaces the location's `content-type` rather than both being sent
	const headers: Record<string, string> = {};

	for (const [name, value] of [...Object.entries(defaults.headers ?? {}), ...Object.entries(options?.headers ?? {})]) {
		headers[name.toLowerCase()] = value;
	}

	const timeout = options?.timeout ?? defaults.timeout;

	return {
		...options,
		...(Object.keys(headers).length > 0 ? { headers } : {}),
		...(timeout !== undefined ? { timeout } : {}),
	} as O;
};

/**
 * The shape of a driver's `call()`, as the manager wraps it with a location's defaults.
 *
 * @internal
 */
type CallFunction = (method: string, params?: Record<string, unknown>, options?: CallDefaults) => Promise<unknown>;

/**
 * One entry of {@link DriverManager.registerLocation}: which driver and what to hand its constructor.
 *
 * A discriminated union over the driver map, so `driver` decides the type of `options`: with
 * `{ local: LocalOptions; bullmq: BullmqOptions }`, `{
 * 	driver: 'bullmq',
 * 	options,
 * }` only compiles with
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
		/**
		 * Headers and a timeout every `call()` of the location's driver gets — an API version, an account — under the
		 * call's own options; ignored for a driver without `call()`.
		 */
		call?: CallDefaults | undefined;
	};
}[keyof Drivers & string];

/**
 * Registry of driver classes and of the named instances — locations — built from them.
 *
 * The one registration shape every subsystem of the kit shares: storage, queues, key-value stores and so on all
 * expose a manager of this class, so an application wires each of them the same way at start-up — drivers as
 * classes, locations as explicit options read from its own configuration. Nothing is read from the environment here.
 * The {@link LocationManager} underneath builds a location on its first {@link DriverManager.location} call, not at
 * registration, so a process that never touches a location never opens its connections — what a serverless cold
 * start wants — and a driver is instantiated once per location, so one class (S3, say) can back several locations
 * with different credentials. Order matters: a location can only be registered once its driver is.
 * {@link DriverManager.close} calls the `close()` of every driver built so far that has one.
 *
 * `Drivers` maps the driver names to their options, so a location's `options` are checked against the driver it
 * names. Each subsystem declares its map as an augmentable interface, so a driver package or an application can add
 * its own driver to the map with `declare module`.
 *
 * @typeParam Instance - What a driver builds; what {@link DriverManager.location} hands out.
 * @typeParam Drivers - Driver names mapped to the options their constructor takes.
 * @example
 * ```ts
 * const storage = new DriverManager<StorageDriver, { s3: StorageDriverS3Config; local: StorageDriverLocalConfig }>();
 *
 * storage.registerDriver('s3', StorageDriverS3);
 * storage.registerLocation('uploads', {
 * 	driver: 's3',
 * 	options: {
 * 		bucket: 'uploads',
 * 	},
 * });
 *
 * await storage.location('uploads').write('avatar.png', stream, 'image/png');
 * await storage.close();
 * ```
 */
export class DriverManager<
	Instance extends Closable,
	Drivers extends object = Record<string, unknown>,
> extends LocationManager<Instance, [config: LocationConfig<Drivers>]> {
	/**
	 * Driver classes keyed by the name they were registered under.
	 *
	 * @internal
	 */
	private drivers: Map<string, DriverClass<Instance>> = new Map();

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
	override registerLocation(name: string, config: LocationConfig<Drivers>): void {
		// 1. Resolve the driver class up front, so a typo in the config fails at registration rather than on first use
		if (!this.drivers.has(config.driver)) {
			throw new Error(`Driver "${config.driver}" isn't registered.`);
		}

		// 2. The base keeps the configuration and drops the earlier instance
		super.registerLocation(name, config);
	}

	/**
	 * Instantiate the driver a location names with the location's options.
	 *
	 * @param config - Which driver and which options, as the location was registered with.
	 * @returns The driver instance.
	 * @throws Error when `config.driver` names no registered driver.
	 */
	protected build(config: LocationConfig<Drivers>): Instance {
		// 1. The driver was checked at registration; it may have been replaced since, which is why it is looked up now
		const Driver = this.drivers.get(config.driver);

		if (!Driver) {
			throw new Error(`Driver "${config.driver}" isn't registered.`);
		}

		const instance = new Driver(config.options as never);

		// 2. The location's call defaults go under every `call()` of the instance, so the application sets an API
		//    version or an account once, at registration; a driver without `call()` is left as it is
		const defaults = config.call;
		const target = instance as Instance & { call?: CallFunction };

		if (defaults && typeof target.call === 'function') {
			const original = target.call.bind(instance);

			target.call = (method, params, options) => original(method, params, mergeCallOptions(defaults, options));
		}

		return instance;
	}

	/**
	 * Close a driver that holds connections; one without a `close()` has nothing to release.
	 *
	 * @param driver - A driver built by {@link DriverManager.build}.
	 * @returns Once the driver released everything.
	 */
	protected async release(driver: Instance): Promise<void> {
		// 1. `close()` is optional on every contract: only the drivers with an SDK that keeps connections open have it
		await driver.close?.();
	}
}
