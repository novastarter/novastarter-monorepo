import { PGlite, type PGliteOptions } from '@electric-sql/pglite';
import {
	type DatabaseCapabilities,
	type DatabaseDriver,
	type DatabaseDriverCommonConfig,
	ensureDirectory,
	type MigrateOptions,
	resolveLogger,
	toDrizzleOptions,
	toMigrationConfig,
	toUnavailableError,
} from '@novastarter/database';
import type { Logger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

/**
 * The `connection` value that keeps the database in memory, gone when the driver closes.
 *
 * @defaultValue `memory://`
 */
export const MEMORY_DATA_DIR = 'memory://';

/**
 * PGlite options a location may set next to the data directory; the directory itself is `connection`.
 */
export type DatabaseDriverPgliteOptions = Omit<PGliteOptions, 'dataDir'>;

/**
 * The directory a `connection` string names on the local filesystem, `undefined` when it names none.
 *
 * PGlite reads `file://` as a path prefix and every other scheme — `memory://`, `idb://`, `opfs-ahp://` — as a
 * filesystem of its own; a string without a scheme is a path.
 *
 * @param connection - The `connection` string of a location.
 * @returns The path to create, or `undefined` for a database that lives elsewhere than on disk.
 */
export const dataDirectory = (connection: string): string | undefined => {
	// 1. The prefix is PGlite's to read; the filesystem wants the bare path
	if (connection.startsWith('file://')) {
		return connection.slice('file://'.length);
	}

	// 2. Any other scheme names no directory
	if (connection.includes('://')) {
		return undefined;
	}

	return connection;
};

/**
 * Options accepted by {@link DatabaseDriverPglite}.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 */
export type DatabaseDriverPgliteConfig<Schema extends Record<string, unknown> = Record<string, unknown>> =
	DatabaseDriverCommonConfig<Schema> & {
		/**
		 * Where the data lives: {@link MEMORY_DATA_DIR}, a directory path (created with its parents when missing; a
		 * `file://` prefix is accepted), or a ready `PGlite` instance of the caller's own — used as is, `options` then
		 * being the caller's business, and left open by `close()`.
		 */
		connection: string | PGlite;
		/**
		 * What `new PGlite()` gets next to the data directory: `extensions`, `debug`, `initialMemory`, `username`,
		 * `database`, `parsers`, `serializers`, …
		 */
		options?: DatabaseDriverPgliteOptions | undefined;
	};

/**
 * Registers the driver's options in the map of `@novastarter/database`, so a location naming `pglite` has its
 * options checked against {@link DatabaseDriverPgliteConfig}.
 */
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		pglite: DatabaseDriverPgliteConfig;
	}
}

/**
 * Database driver for PGlite: PostgreSQL running inside the process on WebAssembly, under Drizzle's `PgliteDatabase`.
 *
 * A real Postgres without a server, so a `pgTable` schema and its migrations run unchanged — development, tests and
 * small deployments on the same code as production. One exclusive connection rather than a pool: PGlite serialises
 * concurrent queries, and `db.transaction()` works. Building the driver starts the boot (the WASM module and the
 * data bundle, then `initdb` on a fresh directory); the first query waits for it. One instance per data directory
 * at a time. The instance is reachable as `db.$client` for `dumpDataDir()`, `listen()` and the extensions.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @example
 * ```ts
 * import { useDatabase } from '@novastarter/database';
 * import { DatabaseDriverPglite } from '@novastarter/database-driver-pglite';
 * import { env } from './env';
 * import * as schema from './db/schema';
 *
 * const database = useDatabase();
 *
 * database.registerDriver('pglite', DatabaseDriverPglite);
 * database.registerLocation('default', {
 * 	driver: 'pglite',
 * 	options: {
 * 		connection: env.DATABASE_PGLITE_DIR,
 * 		schema,
 * 	},
 * });
 * ```
 */
export class DatabaseDriverPglite<
	Schema extends Record<string, unknown> = Record<string, unknown>,
> implements DatabaseDriver<PgliteDatabase<Schema> & { $client: PGlite }> {
	/** The Drizzle database over the instance; `db.$client` is the PGlite instance. */
	readonly db: PgliteDatabase<Schema> & { $client: PGlite };

	/**
	 * What the dialect and the transport can do: one session, so `db.transaction()` works.
	 */
	readonly capabilities: DatabaseCapabilities = { transactions: true };

	/**
	 * The location's name, for the log lines and the error `ping()` throws; the manager fills it in.
	 *
	 * @internal
	 */
	private readonly label: string | undefined;

	/**
	 * The instance every query runs on.
	 *
	 * @internal
	 */
	private readonly client: PGlite;

	/**
	 * Whether the instance was started here and is therefore closed here.
	 *
	 * @internal
	 */
	private readonly ownsClient: boolean;

	/**
	 * Where a failed boot and, when asked for, the queries are reported.
	 *
	 * @internal
	 */
	private readonly logger: Logger;

	/**
	 * Create a driver over an instance, starting one when given a data directory.
	 *
	 * @param config - Data directory or instance, PGlite options, schema and logging options.
	 * @throws Error when `connection` is missing.
	 * @throws What the filesystem raised when the directory could not be created.
	 */
	constructor(config: DatabaseDriverPgliteConfig<Schema>) {
		// 1. Refuse a missing connection up front: an empty string would silently be a database in memory whose
		//    writes vanish at exit
		if (!config.connection) {
			throw new Error('The pglite database driver needs a "connection"');
		}

		this.label = config.label;
		this.logger = resolveLogger(config);

		// 2. A given instance belongs to whoever created it; a data directory becomes an instance of the driver's own
		this.ownsClient = typeof config.connection === 'string';

		if (typeof config.connection === 'string') {
			// 3. A directory wants its parents: PGlite's Node filesystem creates the leaf only, and a fresh checkout
			//    has no `data/` yet. Done here, synchronously, so a bad path fails in the constructor rather than
			//    inside the boot; `memory://` and the other URL schemes name no directory
			const directory = dataDirectory(config.connection);

			if (directory !== undefined) {
				ensureDirectory(directory);
			}

			// 4. The options only when given, so PGlite sees no key it would take as a value
			this.client =
				config.options === undefined ? new PGlite(config.connection) : new PGlite(config.connection, config.options);

			// 5. The boot runs on its own promise with nobody awaiting it; a failure there would be an unhandled
			//    rejection, fatal to the process. Logged instead — every query still rejects with the same error
			this.client.waitReady.catch((error: unknown) => {
				this.logger.error(error, 'PGlite failed to start');
			});
		} else {
			this.client = config.connection;
		}

		// 6. Drizzle over the instance, with the schema and, when asked for, the query logger
		this.db = drizzle(this.client, toDrizzleOptions(config, this.logger));
	}

	/**
	 * Run `select 1` on the instance; the first call waits for the boot.
	 *
	 * @returns Once the database answered.
	 * @throws DatabaseUnavailableError naming the location, with what the boot or the query raised as its `cause`.
	 */
	async ping(): Promise<void> {
		// 1. The cheapest statement; through Drizzle, so the same path the queries take is proven
		try {
			await this.db.execute(sql`select 1`);
		} catch (error) {
			// 2. One error for every backend, 503, naming the location; the boot's or the query's error stays as `cause`
			throw toUnavailableError(error, this.label);
		}
	}

	/**
	 * Apply the pending migrations of a drizzle-kit folder with Drizzle's PGlite migrator.
	 *
	 * @param options - The folder and, optionally, the journal table and schema.
	 * @returns Once every pending migration ran.
	 * @throws Error when `migrationsFolder` is missing; what the migrator raised otherwise.
	 */
	async migrate(options: MigrateOptions): Promise<void> {
		// 1. The migrator runs the pending files in one transaction, as on any Postgres
		await migrate(this.db, toMigrationConfig(options));
	}

	/**
	 * Close the instance, when it is the driver's own and still open.
	 *
	 * @returns Once the instance is closed; a database in memory is gone with it.
	 * @throws What the boot raised, when the instance never came up.
	 */
	async close(): Promise<void> {
		// 1. An instance the caller handed in is theirs to close; one started here would otherwise keep its memory.
		//    PGlite refuses to close twice, so a closed instance is left alone rather than reported as a failure
		if (this.ownsClient && !this.client.closed) {
			await this.client.close();
		}
	}
}
