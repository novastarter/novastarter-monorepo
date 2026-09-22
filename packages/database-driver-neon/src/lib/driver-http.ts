import { type HTTPTransactionOptions, neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
	type DatabaseDriver,
	type DatabaseDriverCommonConfig,
	type MigrateOptions,
	toDrizzleOptions,
	toMigrationConfig,
} from '@novastarter/database';
import { useLogger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

/**
 * The query function of `@neondatabase/serverless` in the shape Drizzle drives: rows as objects, results unwrapped.
 */
export type NeonHttpClient = NeonQueryFunction<false, false>;

/**
 * Options of `neon()` a location may set: `authToken` for Neon Authorize, `fetchOptions` for the requests, the
 * isolation of `db.batch()`. `arrayMode` and `fullResults` are Drizzle's to choose per query, hence left out.
 */
export type DatabaseDriverNeonHttpOptions = Omit<HTTPTransactionOptions<false, false>, 'arrayMode' | 'fullResults'>;

/**
 * Options accepted by {@link DatabaseDriverNeonHttp}.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 */
export type DatabaseDriverNeonHttpConfig<Schema extends Record<string, unknown> = Record<string, unknown>> =
	DatabaseDriverCommonConfig<Schema> & {
		/**
		 * How the database is reached: the project's connection string from the Neon console, or a ready `neon()`
		 * query function of the caller's own — used as is, `options` then being the caller's business.
		 */
		connection: string | NeonHttpClient;
		/** What `neon()` is called with next to the connection string. */
		options?: DatabaseDriverNeonHttpOptions | undefined;
	};

/**
 * Registers the driver's options in the map of `@novastarter/database`, so a location naming `neon-http` has its
 * options checked against {@link DatabaseDriverNeonHttpConfig}.
 */
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		'neon-http': DatabaseDriverNeonHttpConfig;
	}
}

/**
 * Database driver for Neon over HTTP: one fetch per query under Drizzle's `NeonHttpDatabase`.
 *
 * No connection is held between queries, which is what a serverless function or an edge runtime wants: nothing to
 * warm up, nothing to close, the lowest latency for a single statement. The price is sessions: `db.transaction()`
 * throws (`No transactions support in neon-http driver`) — `db.batch()` runs several statements in one
 * non-interactive transaction instead — and `migrate()` applies its statements one by one without a rollback, so a
 * failing migration leaves the ones before it applied. A process that needs interactive transactions is better off on
 * {@link DatabaseDriverNeon}. The query function is reachable as `db.$client`.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @example
 * ```ts
 * import { useDatabase } from '@novastarter/database';
 * import { DatabaseDriverNeonHttp } from '@novastarter/database-driver-neon';
 * import { env } from './env';
 * import * as schema from './db/schema';
 *
 * const database = useDatabase();
 *
 * database.registerDriver('neon-http', DatabaseDriverNeonHttp);
 * database.registerLocation('default', {
 * 	driver: 'neon-http',
 * 	options: {
 * 		connection: env.DATABASE_URL,
 * 		schema,
 * 	},
 * });
 * ```
 */
export class DatabaseDriverNeonHttp<
	Schema extends Record<string, unknown> = Record<string, unknown>,
> implements DatabaseDriver<NeonHttpDatabase<Schema> & { $client: NeonHttpClient }> {
	/** The Drizzle database over the query function; `db.$client` is that function. */
	readonly db: NeonHttpDatabase<Schema> & { $client: NeonHttpClient };

	/**
	 * Create a driver over a query function, building one when given a connection string.
	 *
	 * @param config - Connection, `neon()` options, schema and logging options.
	 * @throws Error when `connection` is missing.
	 */
	constructor(config: DatabaseDriverNeonHttpConfig<Schema>) {
		// 1. Refuse a missing connection up front: `neon('')` would throw a less telling error on the first query
		if (!config.connection) {
			throw new Error('The neon-http database driver needs a "connection"');
		}

		// 2. A given function is used as is; a string becomes one of the driver's own, with the options only when
		//    given, so `neon()` sees no key it would take as a value
		let client: NeonHttpClient;

		if (typeof config.connection === 'function') {
			client = config.connection;
		} else if (config.options === undefined) {
			client = neon(config.connection);
		} else {
			client = neon(config.connection, config.options);
		}

		// 3. Drizzle over the function, with the schema and, when asked for, the query logger
		this.db = drizzle(client, toDrizzleOptions(config, config.logger ?? useLogger()));
	}

	/**
	 * Run `select 1` over HTTP.
	 *
	 * @returns Once the database answered.
	 * @throws What the request raised when it could not.
	 */
	async ping(): Promise<void> {
		// 1. The cheapest statement a server answers; through Drizzle, so the same path the queries take is proven
		await this.db.execute(sql`select 1`);
	}

	/**
	 * Apply the pending migrations of a drizzle-kit folder with Drizzle's Neon HTTP migrator.
	 *
	 * Statement by statement, each in its own request: there is no transaction to roll back when one fails, so the
	 * statements before it stay applied and the journal does not record the migration. Fix the cause and run again.
	 *
	 * @param options - The folder and, optionally, the journal table and schema.
	 * @returns Once every pending migration ran.
	 * @throws Error when `migrationsFolder` is missing; what the migrator raised otherwise.
	 */
	async migrate(options: MigrateOptions): Promise<void> {
		// 1. The HTTP migrator sends each statement as a request of its own
		await migrate(this.db, toMigrationConfig(options));
	}
}
