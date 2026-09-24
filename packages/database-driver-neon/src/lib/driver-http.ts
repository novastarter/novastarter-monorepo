import { type HTTPTransactionOptions, neon, type NeonQueryFunction } from '@neondatabase/serverless';
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
import { InvalidConfigError } from '@novastarter/errors';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';

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
 * non-interactive transaction instead, and `migrate()` sends each migration with its journal row as one such batch. A
 * process that needs interactive transactions is better off on {@link DatabaseDriverNeon}. The query function is reachable as `db.$client`.
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
	 * What the dialect and the transport can do: no session over HTTP, so `db.transaction()` throws and `db.batch()`
	 * is the one transaction.
	 */
	readonly capabilities: DatabaseCapabilities = { transactions: false };

	/**
	 * The location's name, for the log lines and the error `ping()` throws; the manager fills it in.
	 *
	 * @internal
	 */
	private readonly label: string | undefined;

	/**
	 * Create a driver over a query function, building one when given a connection string.
	 *
	 * @param config - Connection, `neon()` options, schema and logging options.
	 * @throws InvalidConfigError when `connection` is missing.
	 */
	constructor(config: DatabaseDriverNeonHttpConfig<Schema>) {
		// `neon('')` would otherwise throw a less telling error on the first query
		if (!config.connection) {
			throw new InvalidConfigError({ reason: 'The neon-http database driver needs a "connection"' });
		}

		// The options are passed only when given, so `neon()` sees no key it would take as a value
		let client: NeonHttpClient;

		if (typeof config.connection === 'function') {
			client = config.connection;
		} else if (config.options === undefined) {
			client = neon(config.connection);
		} else {
			client = neon(config.connection, config.options);
		}

		this.label = config.label;
		this.db = drizzle(client, toDrizzleOptions(config, resolveLogger(config)));
	}

	/**
	 * Run `select 1` over HTTP.
	 *
	 * @returns Once the database answered.
	 * @throws DatabaseUnavailableError naming the location, with what the request raised as its `cause`.
	 */
	async ping(): Promise<void> {
		// Through Drizzle, so the same path the queries take is proven
		try {
			await this.db.execute(sql`select 1`);
		} catch (error) {
			// One error for every backend; the request's error stays as `cause`
			throw toUnavailableError(error, this.label);
		}
	}

	/**
	 * Apply the pending migrations of a drizzle-kit folder, each one in a Neon HTTP transaction of its own.
	 *
	 * Drizzle's Neon HTTP migrator runs every pending migration first and writes the journal rows only at the end, so a
	 * failure in a later migration left the earlier ones applied but unrecorded, and the next run replayed them. Here a
	 * migration's statements and its journal row go in one non-interactive transaction: a failing migration is rolled
	 * back whole, the ones before it stay applied and recorded, and a re-run resumes from the failed one. The journal
	 * table, its schema and the "pending" rule (`created_at` older than the migration) are Drizzle's, so a database
	 * migrated by either stays readable by the other. Statements Postgres refuses inside a transaction block are not
	 * supported: `CREATE INDEX CONCURRENTLY`, or an enum value added by `ALTER TYPE ... ADD VALUE` and used later in the
	 * same migration. The `readOnly` and `deferrable` options of the connection do not apply to migrations.
	 *
	 * @param options - The folder and, optionally, the journal table and schema.
	 * @returns Once every pending migration ran.
	 * @throws InvalidConfigError when `migrationsFolder` is missing; what the migration files or the database raised otherwise.
	 */
	async migrate(options: MigrateOptions): Promise<void> {
		// The options are validated and the folder read before any request is made
		const config = toMigrationConfig(options);
		const migrations = readMigrationFiles(config);

		const journal = `${quoteIdentifier(config.migrationsSchema ?? 'drizzle')}.${quoteIdentifier(
			config.migrationsTable ?? '__drizzle_migrations',
		)}`;

		const client = this.db.$client;

		// Both statements are idempotent, so running them every time is safe
		await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(config.migrationsSchema ?? 'drizzle')}`);

		await client.query(
			`CREATE TABLE IF NOT EXISTS ${journal} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
		);

		// The newest recorded migration marks where the folder is caught up to, the same rule Drizzle applies
		const [last] = (await client.query(`select created_at from ${journal} order by created_at desc limit 1`)) as {
			created_at: string | number | null;
		}[];

		// Each pending migration and its journal row commit together or not at all, in folder order, so a failure
		// stops the run with everything before it recorded; `readOnly` and `deferrable` are pinned because the query
		// function's own defaults, meant for `db.batch()`, would otherwise open a migration as READ ONLY
		for (const migration of migrations) {
			if (last !== undefined && Number(last.created_at) >= migration.folderMillis) {
				continue;
			}

			await client.transaction(
				[
					...migration.sql.map((statement) => client.query(statement)),
					client.query(`insert into ${journal} ("hash", "created_at") values ($1, $2)`, [
						migration.hash,
						migration.folderMillis,
					]),
				],
				{ readOnly: false, deferrable: false },
			);
		}
	}
}

/**
 * Quote a Postgres identifier, doubling any quote inside it, so a configured journal name cannot break the statement.
 *
 * @param name - The schema or table name.
 * @returns The name in double quotes.
 * @internal
 */
const quoteIdentifier = (name: string): string => {
	// Postgres escapes a double quote inside a quoted identifier by doubling it
	return `"${name.replaceAll('"', '""')}"`;
};
