import type { D1Database } from '@cloudflare/workers-types';
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
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { migrate } from 'drizzle-orm/d1/migrator';

/**
 * Options accepted by {@link DatabaseDriverD1}.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 */
export type DatabaseDriverD1Config<Schema extends Record<string, unknown> = Record<string, unknown>> =
	DatabaseDriverCommonConfig<Schema> & {
		/**
		 * The D1 binding the platform hands the code: `env.DB` in a Worker, `getCloudflareContext().env.DB` under
		 * OpenNext, the `env` of wrangler's `getPlatformProxy()` in a local script. Typed by
		 * `@cloudflare/workers-types`, which this package ships.
		 */
		binding: D1Database;
	};

/**
 * Registers the driver's options in the map of `@novastarter/database`, so a location naming `d1` has its options
 * checked against {@link DatabaseDriverD1Config}.
 */
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		d1: DatabaseDriverD1Config;
	}
}

/**
 * Database driver for Cloudflare D1: the Worker's binding under Drizzle's `DrizzleD1Database`.
 *
 * D1 has no connection string; the platform injects a binding into the code it runs, and the application passes that
 * binding on. There is nothing to open and nothing to close. D1 speaks SQLite, so the schema is written with
 * `sqliteTable`, and the API is asynchronous — unlike the better-sqlite3 driver's. `db.transaction()` sends
 * `begin`/`commit`, which D1 rejects; `db.batch()` runs several statements atomically instead. The binding is
 * reachable as `db.$client`.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @example
 * ```ts
 * import { useDatabase } from '@novastarter/database';
 * import { DatabaseDriverD1 } from '@novastarter/database-driver-d1';
 * import * as schema from './db/schema';
 *
 * export default {
 * 	async fetch(request: Request, env: Env): Promise<Response> {
 * 		const database = useDatabase();
 *
 * 		if (!database.hasLocation('default')) {
 * 			database.registerDriver('d1', DatabaseDriverD1);
 * 			database.registerLocation('default', {
 * 				driver: 'd1',
 * 				options: {
 * 					binding: env.DB,
 * 					schema,
 * 				},
 * 			});
 * 		}
 *
 * 		// …
 * 	},
 * };
 * ```
 */
export class DatabaseDriverD1<
	Schema extends Record<string, unknown> = Record<string, unknown>,
> implements DatabaseDriver<DrizzleD1Database<Schema> & { $client: D1Database }> {
	/** The Drizzle database over the binding; `db.$client` is the binding. */
	readonly db: DrizzleD1Database<Schema> & { $client: D1Database };

	/**
	 * What the dialect and the transport can do: D1 refuses the `begin` Drizzle sends, so `db.batch()` is the one
	 * transaction.
	 */
	readonly capabilities: DatabaseCapabilities = { transactions: false };

	/**
	 * The location's name, for the log lines and the error `ping()` throws; the manager fills it in.
	 *
	 * @internal
	 */
	private readonly label: string | undefined;

	/**
	 * Create a driver over a binding.
	 *
	 * @param config - Binding, schema and logging options.
	 * @throws InvalidConfigError when `binding` is missing.
	 */
	constructor(config: DatabaseDriverD1Config<Schema>) {
		// Drizzle would otherwise fail on the first query with a `prepare` of `undefined`, far from the wrangler
		// configuration that forgot the binding
		if (!config.binding) {
			throw new InvalidConfigError({ reason: 'The d1 database driver needs a "binding"' });
		}

		this.label = config.label;
		this.db = drizzle(config.binding, toDrizzleOptions(config, resolveLogger(config)));
	}

	/**
	 * Run `select 1` on the binding.
	 *
	 * @returns Once the database answered.
	 * @throws DatabaseUnavailableError naming the location, with what D1 raised as its `cause`.
	 */
	async ping(): Promise<void> {
		// Through Drizzle, so the same path the queries take is proven
		try {
			await this.db.run(sql`select 1`);
		} catch (error) {
			// One error for every backend; D1's error stays as `cause`
			throw toUnavailableError(error, this.label);
		}
	}

	/**
	 * Apply the pending migrations of a drizzle-kit folder with Drizzle's D1 migrator.
	 *
	 * The migrator reads the folder through `node:fs`, so this runs from a Node process holding the binding — a deploy
	 * script over wrangler's `getPlatformProxy()` — not from inside a Worker. The statements go to D1 as one batch.
	 *
	 * @param options - The folder and, optionally, the journal table; `migrationsSchema` means nothing to SQLite.
	 * @returns Once every pending migration ran.
	 * @throws InvalidConfigError when `migrationsFolder` is missing; what the migrator raised otherwise.
	 */
	async migrate(options: MigrateOptions): Promise<void> {
		await migrate(this.db, toMigrationConfig(options));
	}
}
