import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Client, type Config, createClient } from '@libsql/client';
import {
	type DatabaseDriver,
	type DatabaseDriverCommonConfig,
	type MigrateOptions,
	toDrizzleOptions,
	toMigrationConfig,
} from '@novastarter/database';
import { useLogger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { isClient } from './is-client.js';
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
	 */
	constructor(config: DatabaseDriverTursoConfig<Schema>) {
		// 1. Refuse a missing connection up front, and a config without a URL with it: libsql would report an invalid
		//    URL of `undefined`, far from the configuration at fault
		if (
			!config.connection ||
			(!isClient(config.connection) && typeof config.connection !== 'string' && !config.connection.url)
		) {
			throw new Error('The turso database driver needs a "connection"');
		}

		// 2. A given client belongs to whoever created it; a URL or a config become a client of the driver's own
		this.ownsClient = !isClient(config.connection);

		if (isClient(config.connection)) {
			this.client = config.connection;
		} else {
			// 3. A local file wants its directory: libsql opens the file as soon as the client is created, and SQLite
			//    creates no directories
			const clientConfig: Config =
				typeof config.connection === 'string' ? { url: config.connection } : config.connection;

			const path = localFilePath(clientConfig.url);

			if (path !== undefined) {
				mkdirSync(dirname(path), { recursive: true });
			}

			this.client = createClient(clientConfig);
		}

		// 4. Drizzle over the client, with the schema and, when asked for, the query logger
		this.db = drizzle(this.client, toDrizzleOptions(config, config.logger ?? useLogger()));
	}

	/**
	 * Run `select 1` on the client.
	 *
	 * @returns Once the database answered.
	 * @throws What libsql raised when it could not.
	 */
	async ping(): Promise<void> {
		// 1. The cheapest statement; through Drizzle, so the same path the queries take is proven
		await this.db.run(sql`select 1`);
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
