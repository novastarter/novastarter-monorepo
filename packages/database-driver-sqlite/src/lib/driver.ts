import { dirname } from 'node:path';
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
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

/**
 * The `file` value that opens a database in memory, gone when the driver closes.
 *
 * @defaultValue `:memory:`
 */
export const MEMORY_FILE = ':memory:';

/**
 * Options accepted by {@link DatabaseDriverSqlite}.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 */
export type DatabaseDriverSqliteConfig<Schema extends Record<string, unknown> = Record<string, unknown>> =
	DatabaseDriverCommonConfig<Schema> & {
		/**
		 * Path of the database file, created with its directory when missing, or {@link MEMORY_FILE} for a database
		 * that lives as long as the driver.
		 */
		file: string;
		/** better-sqlite3 open options: `readonly`, `fileMustExist`, `timeout`, `verbose`, `nativeBinding`. */
		options?: Database.Options | undefined;
		/** Enforce foreign keys (`PRAGMA foreign_keys = ON`); SQLite leaves them off. @defaultValue true */
		foreignKeys?: boolean | undefined;
		/**
		 * Write-ahead logging (`PRAGMA journal_mode = WAL`), so readers no longer block the writer; meaningless for
		 * a database in memory.
		 *
		 * @defaultValue true for a file, false for {@link MEMORY_FILE}
		 */
		wal?: boolean | undefined;
	};

/**
 * Registers the driver's options in the map of `@novastarter/database`, so a location naming `sqlite` has its
 * options checked against {@link DatabaseDriverSqliteConfig}.
 */
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		sqlite: DatabaseDriverSqliteConfig;
	}
}

/**
 * Database driver for SQLite: a better-sqlite3 database under Drizzle's `BetterSQLite3Database`.
 *
 * better-sqlite3 is synchronous, so `ping()` and `migrate()` do their work before their promise resolves and the
 * queries on {@link DatabaseDriverSqlite.db} answer without awaiting — `db.select().from(t).all()` — while `await`
 * works on them too. The database file is opened, and its directory created, when the driver is built; the manager
 * builds it on the location's first use. The better-sqlite3 handle is reachable as `db.$client` for pragmas and
 * backups Drizzle does not cover.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @example
 * ```ts
 * import { useDatabase } from '@novastarter/database';
 * import { DatabaseDriverSqlite } from '@novastarter/database-driver-sqlite';
 * import { env } from './env';
 * import * as schema from './db/schema';
 *
 * const database = useDatabase();
 *
 * database.registerDriver('sqlite', DatabaseDriverSqlite);
 * database.registerLocation('default', {
 * 	driver: 'sqlite',
 * 	options: {
 * 		file: env.DATABASE_FILE,
 * 		schema,
 * 	},
 * });
 * ```
 */
export class DatabaseDriverSqlite<
	Schema extends Record<string, unknown> = Record<string, unknown>,
> implements DatabaseDriver<BetterSQLite3Database<Schema> & { $client: Database.Database }> {
	/** The Drizzle database over the file; `db.$client` is the better-sqlite3 handle. */
	readonly db: BetterSQLite3Database<Schema> & { $client: Database.Database };

	/**
	 * What the dialect and the transport can do: sessions, so `db.transaction()` works.
	 */
	readonly capabilities: DatabaseCapabilities = { transactions: true };

	/**
	 * The location's name, for the log lines and the error `ping()` throws; the manager fills it in.
	 *
	 * @internal
	 */
	private readonly label: string | undefined;

	/**
	 * The open database handle every query runs on.
	 *
	 * @internal
	 */
	private readonly database: Database.Database;

	/**
	 * Open the database, creating the file and its directory when missing.
	 *
	 * @param config - File, open options, pragmas, schema and logging options.
	 * @throws Error when `file` is missing.
	 * @throws What better-sqlite3 raised when the file could not be opened — a missing file under `fileMustExist`,
	 * a directory without write access.
	 */
	constructor(config: DatabaseDriverSqliteConfig<Schema>) {
		// 1. Refuse a missing file up front: better-sqlite3 would open an anonymous database in memory and every
		//    write would silently vanish at exit
		if (!config.file) {
			throw new Error('The sqlite database driver needs a "file"');
		}

		// 2. A file wants its directory: better-sqlite3 cannot create it, and a fresh checkout has no `data/` yet
		const inMemory = config.file === MEMORY_FILE;

		if (!inMemory) {
			ensureDirectory(dirname(config.file));
		}

		this.database =
			config.options === undefined ? new Database(config.file) : new Database(config.file, config.options);

		// 3. Foreign keys are off in SQLite unless every connection turns them on; a schema declaring references
		//    expects them enforced, so on by default
		if (config.foreignKeys ?? true) {
			this.database.pragma('foreign_keys = ON');
		}

		// 4. WAL lets readers and the writer proceed together, what a server wants from a file; a database in memory
		//    has no journal to speak of
		if (config.wal ?? !inMemory) {
			this.database.pragma('journal_mode = WAL');
		}

		// 5. Drizzle over the handle, with the schema and, when asked for, the query logger bound to the label
		this.label = config.label;
		this.db = drizzle(this.database, toDrizzleOptions(config, resolveLogger(config)));
	}

	/**
	 * Run `select 1` on the database.
	 *
	 * @returns Once the statement ran; before the promise resolves, since better-sqlite3 is synchronous.
	 * @throws DatabaseUnavailableError naming the location, with what better-sqlite3 raised as its `cause`.
	 */
	async ping(): Promise<void> {
		// 1. The cheapest statement; through Drizzle, so the same path the queries take is proven
		try {
			this.db.run(sql`select 1`);
		} catch (error) {
			// 2. One error for every backend, 503, naming the location; better-sqlite3's error stays as `cause`
			throw toUnavailableError(error, this.label);
		}
	}

	/**
	 * Apply the pending migrations of a drizzle-kit folder with Drizzle's better-sqlite3 migrator.
	 *
	 * @param options - The folder and, optionally, the journal table; `migrationsSchema` means nothing to SQLite.
	 * @returns Once every pending migration ran; before the promise resolves, since the migrator is synchronous.
	 * @throws Error when `migrationsFolder` is missing; what the migrator raised otherwise.
	 */
	async migrate(options: MigrateOptions): Promise<void> {
		// 1. The migrator runs the pending files in one transaction on the open handle
		migrate(this.db, toMigrationConfig(options));
	}

	/**
	 * Close the database handle.
	 *
	 * @returns Once the file is closed; a database in memory is gone with it.
	 */
	async close(): Promise<void> {
		// 1. The handle is the driver's own — better-sqlite3 has no pool to share — so closing it is always right
		this.database.close();
	}
}
