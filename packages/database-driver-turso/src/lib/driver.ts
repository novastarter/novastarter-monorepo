import { dirname } from 'node:path';
import { type Client, type Config, createClient } from '@libsql/client';
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
import { hasMethods } from '@novastarter/utils';
import { sql } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { localFilePath } from './local-file-path.js';

/**
 * The `connection` value that keeps the database in memory, gone when the driver closes.
 *
 * @defaultValue `:memory:`
 */
export const MEMORY_URL = ':memory:';

/**
 * Options accepted by {@link DatabaseDriverTurso}.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 */
export type DatabaseDriverTursoConfig<Schema extends Record<string, unknown> = Record<string, unknown>> =
	DatabaseDriverCommonConfig<Schema> & {
		/**
		 * How the database is reached: a URL alone — `file:./data/app.db` (created with its directory when missing),
		 * {@link MEMORY_URL}, `libsql://db-org.turso.io`, `https://`, `wss://` — the full `Config` of `@libsql/client`
		 * (`url` plus `authToken`, `syncUrl`, `syncInterval`, `encryptionKey`, `intMode`, `concurrency`, `timeout`),
		 * or a ready `Client` of the caller's own — used as is and left open by `close()`.
		 */
		connection: string | Config | Client;
	};

/**
 * Registers the driver's options in the map of `@novastarter/database`, so a location naming `turso` has its options
 * checked against {@link DatabaseDriverTursoConfig}.
 */
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		turso: DatabaseDriverTursoConfig;
	}
}

/**
 * Database driver for Turso and libSQL: a `@libsql/client` client under Drizzle's `LibSQLDatabase`.
 *
 * One client, three ways to run it: a local file (or a database in memory) through the native libSQL binding, a
 * remote Turso database over HTTPS or WebSocket, or an embedded replica — a local file kept in sync with a remote
 * one through `syncUrl`. The API is asynchronous throughout, unlike the better-sqlite3 driver's; `db.batch()` runs
 * several statements in one transaction and `db.transaction()` is interactive. A local file is opened when the driver
 * is built, so a path that cannot be opened fails there. The client is reachable as `db.$client` for `sync()` and
 * `executeMultiple()`.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @example
 * ```ts
 * import { useDatabase } from '@novastarter/database';
 * import { DatabaseDriverTurso } from '@novastarter/database-driver-turso';
 * import { env } from './env';
 * import * as schema from './db/schema';
 *
 * const database = useDatabase();
 *
 * database.registerDriver('turso', DatabaseDriverTurso);
 * database.registerLocation('default', {
 * 	driver: 'turso',
 * 	options: {
 * 		connection: {
 * 			url: env.TURSO_DATABASE_URL,
 * 			authToken: env.TURSO_AUTH_TOKEN,
 * 		},
 * 		schema,
 * 	},
 * });
 * ```
 */
export class DatabaseDriverTurso<
	Schema extends Record<string, unknown> = Record<string, unknown>,
> implements DatabaseDriver<LibSQLDatabase<Schema> & { $client: Client }> {
	/** The Drizzle database over the client; `db.$client` is the client. */
	readonly db: LibSQLDatabase<Schema> & { $client: Client };

	/**
	 * What the dialect and the transport can do: interactive transactions over every transport, so
	 * `db.transaction()` works.
	 */
	readonly capabilities: DatabaseCapabilities = { transactions: true };

	/**
	 * The location's name, for the log lines and the error `ping()` throws; the manager fills it in.
	 *
	 * @internal
	 */
	private readonly label: string | undefined;

	/**
	 * The client every query runs on.
	 *
	 * @internal
	 */
	private readonly client: Client;

	/**
	 * Whether the client was opened here and is therefore closed here.
	 *
	 * @internal
	 */
	private readonly ownsClient: boolean;

	/**
	 * Create a driver over a client, opening one when given a URL or a config.
	 *
	 * @param config - Connection, schema and logging options.
	 * @throws Error when `connection` is missing, or is a config without a `url`.
	 * @throws What libsql raised when a local file could not be opened.
	 * @throws What the filesystem raised when the directory of a local file could not be created.
	 */
	constructor(config: DatabaseDriverTursoConfig<Schema>) {
		// 1. Refuse a missing connection up front, and a config without a URL with it: libsql would report an invalid
		//    URL of `undefined`, far from the configuration at fault
		if (
			!config.connection ||
			(!hasMethods<Client>(config.connection, ['execute', 'close']) &&
				typeof config.connection !== 'string' &&
				!config.connection.url)
		) {
			throw new Error('The turso database driver needs a "connection"');
		}

		// 2. A given client belongs to whoever created it — told by the methods the driver calls, since a client from
		//    another copy of the SDK fails `instanceof`; a URL or a config become a client of the driver's own
		this.ownsClient = !hasMethods<Client>(config.connection, ['execute', 'close']);
		this.label = config.label;

		if (hasMethods<Client>(config.connection, ['execute', 'close'])) {
			this.client = config.connection;
		} else {
			// 3. A local file wants its directory: libsql opens the file as soon as the client is created, and SQLite
			//    creates no directories
			const clientConfig: Config =
				typeof config.connection === 'string' ? { url: config.connection } : config.connection;

			const path = localFilePath(clientConfig.url);

			if (path !== undefined) {
				ensureDirectory(dirname(path));
			}

			this.client = createClient(clientConfig);
		}

		// 4. Drizzle over the client, with the schema and, when asked for, the query logger bound to the label
		this.db = drizzle(this.client, toDrizzleOptions(config, resolveLogger(config)));
	}

	/**
	 * Run `select 1` on the client.
	 *
	 * @returns Once the database answered.
	 * @throws DatabaseUnavailableError naming the location, with what libsql raised as its `cause`.
	 */
	async ping(): Promise<void> {
		// 1. The cheapest statement; through Drizzle, so the same path the queries take is proven
		try {
			await this.db.run(sql`select 1`);
		} catch (error) {
			// 2. One error for every backend, 503, naming the location; libsql's error stays as `cause`
			throw toUnavailableError(error, this.label);
		}
	}

	/**
	 * Apply the pending migrations of a drizzle-kit folder with Drizzle's libsql migrator.
	 *
	 * Every pending migration goes to the client in one `migrate()` batch — one transaction with foreign keys off —
	 * so a failing statement rolls all of them back.
	 *
	 * @param options - The folder and, optionally, the journal table; `migrationsSchema` means nothing to SQLite.
	 * @returns Once every pending migration ran.
	 * @throws Error when `migrationsFolder` is missing; what the migrator raised otherwise.
	 */
	async migrate(options: MigrateOptions): Promise<void> {
		// 1. The migrator batches the pending files onto the client
		await migrate(this.db, toMigrationConfig(options));
	}

	/**
	 * Close the client, when it is the driver's own.
	 *
	 * @returns Once the client is closed; libsql closes synchronously, the promise is the contract's.
	 */
	async close(): Promise<void> {
		// 1. A client the caller handed in is theirs to close; one opened here would otherwise keep the file open
		if (this.ownsClient) {
			this.client.close();
		}
	}
}
