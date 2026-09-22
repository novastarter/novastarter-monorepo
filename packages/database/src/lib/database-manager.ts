import { DEFAULT_LOCATION, DriverManager, type LocationConfig } from '@novastarter/utils';
import type { DatabaseDriver } from '../driver.js';
import type { DatabaseDriverCommonConfig } from '../types.js';

/**
 * Database drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * Empty here: each driver package adds itself with a module augmentation, so a location's `options` are checked
 * against the driver it names once the package is imported —
 * `declare module '@novastarter/database' { interface DatabaseDrivers { postgres: DatabaseDriverPostgresConfig } }`.
 * An application does the same for a driver of its own.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by the driver packages
export interface DatabaseDrivers {}

/**
 * Location names mapped to the Drizzle database type behind them, so {@link DatabaseManager.location} hands out a
 * typed `db` without a cast at every call site.
 *
 * Empty here: the application augments it once, next to where it registers the location —
 * `declare module '@novastarter/database' { interface DatabaseLocations { default: NodePgDatabase<typeof schema> } }`.
 * A location the map does not name comes back with `db: unknown`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by the application
export interface DatabaseLocations {}

/**
 * The Drizzle database type of a location, from {@link DatabaseLocations}; `unknown` for a name the map lacks.
 *
 * @typeParam Name - The location name.
 */
export type LocationDb<Name extends string> = Name extends keyof DatabaseLocations ? DatabaseLocations[Name] : unknown;

/**
 * The shape every entry of the location union shares, read through instead of the union itself.
 *
 * The union is `never` while the driver map is empty — before a driver package augments it — and spreading a
 * discriminated union widens it into a cross product TypeScript refuses; the shared shape is what the label is added
 * to.
 *
 * @internal
 */
type AnyLocation = { driver: string; options: DatabaseDriverCommonConfig };

/**
 * Registry that maps named database locations to driver instances.
 *
 * The {@link DriverManager} of the kit for relational databases: drivers are registered as classes and locations as
 * configuration; the manager instantiates one driver per location on its first use, so a single driver can back
 * several databases with different connections and an unused location never opens a pool. Order matters: a location
 * can only be registered once its driver is. The application wires it at start-up through {@link useDatabase}.
 *
 * @example
 * ```ts
 * const database = new DatabaseManager();
 *
 * database.registerDriver('postgres', DatabaseDriverPostgres);
 * database.registerLocation('default', {
 * 	driver: 'postgres',
 * 	options: {
 * 		connection: 'postgresql://app:secret@localhost:5432/app',
 * 		schema,
 * 	},
 * });
 *
 * const users = await database.location().db.select().from(schema.users);
 * ```
 */
export class DatabaseManager extends DriverManager<DatabaseDriver, DatabaseDrivers> {
	/**
	 * Register a location, labelling its options with the location's name.
	 *
	 * The driver never learns which location it serves otherwise; the label is what its log lines and its
	 * {@link DatabaseUnavailableError} name. A label the caller set wins.
	 *
	 * @param name - Location name.
	 * @param config - Driver name and options.
	 * @throws Error when `config.driver` names a driver that has not been registered.
	 */
	override registerLocation(name: string, config: LocationConfig<DatabaseDrivers>): void {
		// 1. Read the options through the shared shape: the union cannot be spread without widening it
		const location = config as AnyLocation;

		// 2. A shallow copy with the label filled in, so the caller's object stays as it was
		const labelled: AnyLocation = {
			...location,
			options: { ...location.options, label: location.options.label ?? name },
		};

		// 3. Back to the union the base class checks; nothing changed at runtime but one key
		super.registerLocation(name, labelled as LocationConfig<DatabaseDrivers>);
	}

	/**
	 * Return the driver of a location, typed by {@link DatabaseLocations}.
	 *
	 * @typeParam Name - The location name, so the map can be looked up at the type level.
	 * @param name - Location name; {@link DEFAULT_LOCATION} when omitted.
	 * @returns The driver built on the location's first use, its `db` typed by the map — `unknown` for a name it lacks.
	 * @throws Error when no location of that name is registered.
	 */
	override location<Name extends string = typeof DEFAULT_LOCATION>(name?: Name): DatabaseDriver<LocationDb<Name>> {
		// 1. The base builds and caches; only the static type is narrowed here, from the map the application augmented,
		//    so the cast changes nothing at runtime
		return super.location(name) as DatabaseDriver<LocationDb<Name>>;
	}
}
