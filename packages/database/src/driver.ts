import type { DatabaseCapabilities, MigrateOptions } from './types.js';

/**
 * Contract every database driver implements: a connection to one database, exposed as a Drizzle database.
 *
 * Declared as an ambient class rather than an interface so that `typeof DatabaseDriver` describes a constructor for
 * {@link DatabaseManager.registerDriver}; no runtime code exists behind it. The dialect decides the type of `db` — a
 * `NodePgDatabase` for PostgreSQL, a `BetterSQLite3Database` for SQLite — and with it the query API the application
 * writes against; an application augments {@link DatabaseLocations} so `location()` hands the right type out.
 *
 * @typeParam Db - The Drizzle database type of the driver's dialect.
 */
export declare class DatabaseDriver<Db = unknown> {
	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Driver-specific options, as given in the location's `options`.
	 */
	constructor(config: Record<string, unknown>);

	/**
	 * The Drizzle database over the location's connection and schema.
	 *
	 * Built with the driver, so the first `location()` that builds the driver opens what the connection needs; the
	 * queries themselves go through Drizzle's API on this object.
	 */
	readonly db: Db;

	/**
	 * What the dialect and the transport can do; see {@link DatabaseCapabilities}.
	 */
	readonly capabilities: DatabaseCapabilities;

	/**
	 * One round trip to the database, so a bootstrap or a health check can prove the location is reachable.
	 *
	 * @returns Once the database answered.
	 * @throws DatabaseUnavailableError (code `DATABASE_UNAVAILABLE`, status 503) naming the location, with what the
	 * connection raised as its `cause`.
	 */
	ping(): Promise<void>;

	/**
	 * Apply the pending drizzle-kit migrations of a folder through the dialect's Drizzle migrator.
	 *
	 * Drizzle keeps a journal table and runs only what it has not recorded, so calling this at every start-up is
	 * safe; the folder is what `drizzle-kit generate` wrote for the application's schema.
	 *
	 * @param options - The folder and, optionally, where the journal table lives.
	 * @returns Once every pending migration ran.
	 * @throws What the migrator raised — a failing statement, a missing folder.
	 */
	migrate(options: MigrateOptions): Promise<void>;

	/**
	 * Release what the driver holds — a connection pool, a file handle — so the process can exit.
	 *
	 * Optional on the contract, although every driver of the kit has something to release. The manager calls it
	 * at shutdown; a connection the application handed in stays the application's to close.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}
