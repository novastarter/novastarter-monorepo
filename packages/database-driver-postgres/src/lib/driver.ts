import {
	type DatabaseCapabilities,
	type DatabaseDriver,
	type DatabaseDriverCommonConfig,
	type MigrateOptions,
	resolveLogger,
	toDrizzleOptions,
	toMigrationConfig,
	toUnavailableError,
} from '@novastarter/database';
import type { Logger } from '@novastarter/logger';
import { hasMethods } from '@novastarter/utils';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolConfig } from 'pg';

/**
 * Options accepted by {@link DatabaseDriverPostgres}.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 */
export type DatabaseDriverPostgresConfig<Schema extends Record<string, unknown> = Record<string, unknown>> =
	DatabaseDriverCommonConfig<Schema> & {
		/**
		 * How the database is reached: a connection string (`postgresql://user:pass@host:5432/db`), node-postgres pool
		 * options, or a ready `Pool`. A string or options open a pool of the driver's own, closed by `close()`; a given
		 * pool is used as is and stays the caller's to end.
		 */
		connection: string | PoolConfig | Pool;
	};

/**
 * Registers the driver's options in the map of `@novastarter/database`, so a location naming `postgres` has its
 * options checked against {@link DatabaseDriverPostgresConfig}.
 */
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		postgres: DatabaseDriverPostgresConfig;
	}
}

/**
 * Database driver for PostgreSQL: a node-postgres pool under Drizzle's `NodePgDatabase`.
 *
 * The pool opens its connections lazily, so building the driver costs nothing until the first query; the manager
 * builds it on the location's first use. Queries go through Drizzle on {@link DatabaseDriverPostgres.db}; the pool
 * itself is reachable as `db.$client` for what Drizzle does not cover.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @example
 * ```ts
 * import { useDatabase } from '@novastarter/database';
 * import { DatabaseDriverPostgres } from '@novastarter/database-driver-postgres';
 * import { env } from './env';
 * import * as schema from './db/schema';
 *
 * const database = useDatabase();
 *
 * database.registerDriver('postgres', DatabaseDriverPostgres);
 * database.registerLocation('default', {
 * 	driver: 'postgres',
 * 	options: {
 * 		connection: env.DATABASE_URL,
 * 		schema,
 * 	},
 * });
 * ```
 */
export class DatabaseDriverPostgres<
	Schema extends Record<string, unknown> = Record<string, unknown>,
> implements DatabaseDriver<NodePgDatabase<Schema> & { $client: Pool }> {
	/** The Drizzle database over the pool; `db.$client` is the pool. */
	readonly db: NodePgDatabase<Schema> & { $client: Pool };

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
	constructor(config: DatabaseDriverPostgresConfig<Schema>) {
		// 1. Refuse a missing connection up front: node-postgres would silently fall back to its `PG*` environment
		//    variables and connect somewhere the configuration never named
		if (!config.connection) {
			throw new Error('The postgres database driver needs a "connection"');
		}

		this.label = config.label;
		this.logger = resolveLogger(config);

		// 2. A given pool belongs to whoever created it — told by the methods the driver calls, since a pool from
		//    another copy of `pg` fails `instanceof`; a string or options become a pool of the driver's own
		this.ownsPool = !hasMethods<Pool>(config.connection, ['connect', 'end']);

		this.pool = hasMethods<Pool>(config.connection, ['connect', 'end'])
			? config.connection
			: new Pool(typeof config.connection === 'string' ? { connectionString: config.connection } : config.connection);

		// 3. An idle client losing its connection emits `error` on the pool, and an unhandled `error` event crashes the
		//    process; the pool of the driver's own gets its listener here, a caller's pool keeps the caller's
		if (this.ownsPool) {
			this.pool.on('error', (error) => {
				this.logger.error(error, 'Postgres pool error');
			});
		}

		// 4. Drizzle over the pool, with the schema and, when asked for, the query logger
		this.db = drizzle(this.pool, toDrizzleOptions(config, this.logger));
	}

	/**
	 * Run `select 1` on the pool.
	 *
	 * @returns Once the database answered.
	 * @throws DatabaseUnavailableError naming the location, with what the connection raised as its `cause`.
	 */
	async ping(): Promise<void> {
		// 1. The cheapest statement a server answers; through Drizzle, so the same path the queries take is proven
		try {
			await this.db.execute(sql`select 1`);
		} catch (error) {
			// 2. One error for every backend, 503, naming the location; the backend's error stays as `cause`
			throw toUnavailableError(error, this.label);
		}
	}

	/**
	 * Apply the pending migrations of a drizzle-kit folder with Drizzle's node-postgres migrator.
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
