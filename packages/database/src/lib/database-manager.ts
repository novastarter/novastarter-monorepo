import { DEFAULT_LOCATION, DriverManager } from '@novastarter/utils';
import type { DatabaseDriver } from '../driver.js';

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
