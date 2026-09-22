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
import { hasMethods } from '@novastarter/utils';
import { sql } from 'drizzle-orm';
import type { Mode } from 'drizzle-orm/mysql-core';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createPool, type Pool, type PoolOptions } from 'mysql2/promise';

/**
 * Options accepted by {@link DatabaseDriverMysql}.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 */
export type DatabaseDriverMysqlConfig<Schema extends Record<string, unknown> = Record<string, unknown>> =
	DatabaseDriverCommonConfig<Schema> & {
		/**
		 * How the database is reached: a connection URI (`mysql://user:pass@host:3306/db`), mysql2 pool options, or a
		 * ready `mysql2/promise` pool. A URI or options open a pool of the driver's own, closed by `close()`; a given
		 * pool is used as is and stays the caller's to end.
		 */
		connection: string | PoolOptions | Pool;
		/**
		 * How Drizzle builds relational queries: `default` joins through lateral subqueries, `planetscale` avoids them
		 * for a database without foreign-key support (PlanetScale, Vitess).
		 *
		 * @defaultValue `default`
		 */
		mode?: Mode | undefined;
	};

/**
 * Registers the driver's options in the map of `@novastarter/database`, so a location naming `mysql` has its options
 * checked against {@link DatabaseDriverMysqlConfig}.
 */
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		mysql: DatabaseDriverMysqlConfig;
	}
}

/**
 * Database driver for MySQL and MariaDB: a mysql2 pool under Drizzle's `MySql2Database`.
 *
 * The pool opens its connections lazily, so building the driver costs nothing until the first query; the manager
 * builds it on the location's first use. Queries go through Drizzle on {@link DatabaseDriverMysql.db}; the pool
 * itself is reachable as `db.$client` for what Drizzle does not cover. Unlike node-postgres, mysql2 reports no
 * `error` event on its pool: a dropped idle connection is discarded inside the pool, so there is nothing to listen to.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @example
 * ```ts
 * import { useDatabase } from '@novastarter/database';
 * import { DatabaseDriverMysql } from '@novastarter/database-driver-mysql';
 * import { env } from './env';
 * import * as schema from './db/schema';
 *
 * const database = useDatabase();
 *
 * database.registerDriver('mysql', DatabaseDriverMysql);
 * database.registerLocation('default', {
 * 	driver: 'mysql',
 * 	options: {
 * 		connection: env.DATABASE_URL,
 * 		schema,
 * 	},
 * });
 * ```
 */
export class DatabaseDriverMysql<
	Schema extends Record<string, unknown> = Record<string, unknown>,
> implements DatabaseDriver<MySql2Database<Schema> & { $client: Pool }> {
	/** The Drizzle database over the pool; `db.$client` is the pool. */
	readonly db: MySql2Database<Schema> & { $client: Pool };

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
	 * Create a driver over a pool, opening one when given a connection URI or options.
	 *
	 * @param config - Connection, mode, schema and logging options.
	 * @throws Error when `connection` is missing.
	 */
	constructor(config: DatabaseDriverMysqlConfig<Schema>) {
		// 1. Refuse a missing connection up front: mysql2 would silently open a pool on `localhost:3306` as `root`,
		//    a server the configuration never named
		if (!config.connection) {
			throw new Error('The mysql database driver needs a "connection"');
		}

		this.label = config.label;

		const logger = resolveLogger(config);

		// 2. A given pool belongs to whoever created it — told by the methods the driver calls, since a pool from
		//    another copy of `mysql2` fails `instanceof`; a URI or options become a pool of the driver's own. The URI
		//    goes in as the `uri` option, the one form `createPool` takes for both shapes
		this.ownsPool = !hasMethods<Pool>(config.connection, ['getConnection', 'end']);

		this.pool = hasMethods<Pool>(config.connection, ['getConnection', 'end'])
			? config.connection
			: createPool(typeof config.connection === 'string' ? { uri: config.connection } : config.connection);

		// 3. Drizzle over the pool, with the schema and, when asked for, the query logger. `mode` is mandatory next to
		//    a schema, so it is always given; Drizzle types the two shapes — with and without a schema — as separate
		//    options objects, hence the two calls
		const { schema, ...options } = toDrizzleOptions(config, logger);
		const mode = config.mode ?? 'default';

		this.db =
			schema === undefined
				? drizzle(this.pool, { ...options, mode })
				: drizzle(this.pool, { ...options, schema, mode });
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
	 * Apply the pending migrations of a drizzle-kit folder with Drizzle's mysql2 migrator.
	 *
	 * @param options - The folder and, optionally, the journal table; `migrationsSchema` means nothing to MySQL.
	 * @returns Once every pending migration ran.
	 * @throws Error when `migrationsFolder` is missing; what the migrator raised otherwise.
	 */
	async migrate(options: MigrateOptions): Promise<void> {
		// 1. The migrator takes a connection from the pool and runs the pending files in one transaction
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
