import { Pool, type PoolConfig } from '@neondatabase/serverless';
import {
	type DatabaseDriver,
	type DatabaseDriverCommonConfig,
	type MigrateOptions,
	toDrizzleOptions,
	toMigrationConfig,
} from '@novastarter/database';
import { type Logger, useLogger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import { isPool } from './is-pool.js';

/**
 * Options accepted by {@link DatabaseDriverNeon}.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 */
export type DatabaseDriverNeonConfig<Schema extends Record<string, unknown> = Record<string, unknown>> =
	DatabaseDriverCommonConfig<Schema> & {
		/**
		 * How the database is reached: the project's connection string from the Neon console, pool options of
		 * `@neondatabase/serverless`, or a ready `Pool` of it. A string or options open a pool of the driver's own,
		 * closed by `close()`; a given pool is used as is and stays the caller's to end.
		 */
		connection: string | PoolConfig | Pool;
	};

/**
 * Registers the driver's options in the map of `@novastarter/database`, so a location naming `neon` has its options
 * checked against {@link DatabaseDriverNeonConfig}.
 */
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		neon: DatabaseDriverNeonConfig;
	}
}

/**
 * Database driver for Neon over WebSocket: a pool of `@neondatabase/serverless` under Drizzle's `NeonDatabase`.
 *
 * The pool is node-postgres's, carried over a WebSocket instead of TCP, so it runs where sockets are unavailable —
 * serverless functions, edge runtimes — while keeping sessions: `db.transaction()` works and `migrate()` runs in one
 * transaction. Node 22 and later has the `WebSocket` the pool needs; older runtimes set
 * `neonConfig.webSocketConstructor` before the first use. Each query on a fresh connection pays for the WebSocket
 * handshake; a process that only ever sends single statements is better off on {@link DatabaseDriverNeonHttp}. The
 * pool is reachable as `db.$client`.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @example
 * ```ts
 * import { useDatabase } from '@novastarter/database';
 * import { DatabaseDriverNeon } from '@novastarter/database-driver-neon';
 * import { env } from './env';
 * import * as schema from './db/schema';
 *
 * const database = useDatabase();
 *
 * database.registerDriver('neon', DatabaseDriverNeon);
 * database.registerLocation('default', {
 * 	driver: 'neon',
 * 	options: {
 * 		connection: env.DATABASE_URL,
 * 		schema,
 * 	},
 * });
 * ```
 */
export class DatabaseDriverNeon<
	Schema extends Record<string, unknown> = Record<string, unknown>,
> implements DatabaseDriver<NeonDatabase<Schema> & { $client: Pool }> {
	/** The Drizzle database over the pool; `db.$client` is the pool. */
	readonly db: NeonDatabase<Schema> & { $client: Pool };

	/**
	 * The pool every query runs on.
	 *
	 * @internal
	 */
	private readonly pool: Pool;

	/**
	 * Whether the pool was opened here and is therefore ended here.
	 *
	 * @internal
	 */
	private readonly ownsPool: boolean;

	/**
	 * Where pool errors and, when asked for, the queries are reported.
	 *
	 * @internal
	 */
	private readonly logger: Logger;

	/**
	 * Create a driver over a pool, opening one when given a connection string or options.
	 *
	 * @param config - Connection, schema and logging options.
	 * @throws Error when `connection` is missing.
	 */
	constructor(config: DatabaseDriverNeonConfig<Schema>) {
		// 1. Refuse a missing connection up front: the pool would silently fall back to node-postgres's `PG*`
		//    environment variables and connect somewhere the configuration never named
		if (!config.connection) {
			throw new Error('The neon database driver needs a "connection"');
		}

		this.logger = config.logger ?? useLogger();

		// 2. A given pool belongs to whoever created it; a string or options become a pool of the driver's own
		this.ownsPool = !isPool(config.connection);

		this.pool = isPool(config.connection)
			? config.connection
			: new Pool(typeof config.connection === 'string' ? { connectionString: config.connection } : config.connection);

		// 3. The pool is node-postgres's: an idle client losing its connection emits `error` on it, and an unhandled
		//    `error` event crashes the process; the pool of the driver's own gets its listener here, a caller's pool
		//    keeps the caller's
		if (this.ownsPool) {
			this.pool.on('error', (error: Error) => {
				this.logger.error(error, 'Neon pool error');
			});
		}

		// 4. Drizzle over the pool, with the schema and, when asked for, the query logger
		this.db = drizzle(this.pool, toDrizzleOptions(config, this.logger));
	}

	/**
	 * Run `select 1` on the pool.
	 *
	 * @returns Once the database answered.
	 * @throws What the connection raised when it could not.
	 */
	async ping(): Promise<void> {
		// 1. The cheapest statement a server answers; through Drizzle, so the same path the queries take is proven
		await this.db.execute(sql`select 1`);
	}

	/**
	 * Apply the pending migrations of a drizzle-kit folder with Drizzle's Neon migrator.
	 *
	 * @param options - The folder and, optionally, the journal table and schema.
	 * @returns Once every pending migration ran.
	 * @throws Error when `migrationsFolder` is missing; what the migrator raised otherwise.
	 */
	async migrate(options: MigrateOptions): Promise<void> {
		// 1. The migrator takes a dedicated client from the pool and runs the pending files in one transaction
		await migrate(this.db, toMigrationConfig(options));
	}

	/**
	 * End the pool, when it is the driver's own.
	 *
	 * @returns Once every connection of the pool is closed.
	 */
	async close(): Promise<void> {
		// 1. A pool the caller handed in is theirs to end; one opened here would otherwise keep the process alive
		if (this.ownsPool) {
			await this.pool.end();
		}
	}
}
