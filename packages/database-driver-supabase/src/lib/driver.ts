import type { DatabaseCapabilities } from '@novastarter/database';
import { DatabaseDriverPostgres } from '@novastarter/database-driver-postgres';
import { type DatabaseDriverSupabaseConfig, toPostgresConfig } from './to-postgres-config.js';

export type { DatabaseDriverSupabaseConfig } from './to-postgres-config.js';

/**
 * Registers the driver's options in the map of `@novastarter/database`, so a location naming `supabase` has its
 * options checked against {@link DatabaseDriverSupabaseConfig}.
 */
declare module '@novastarter/database' {
	interface DatabaseDrivers {
		supabase: DatabaseDriverSupabaseConfig;
	}
}

/**
 * Database driver for Supabase: the project's Postgres over node-postgres, with TLS on by default.
 *
 * Supabase's database is PostgreSQL, so everything runs on {@link DatabaseDriverPostgres}; what this driver adds is
 * the shape of a Supabase configuration — the dashboard's connection string, TLS verified unless switched off, the
 * project's root certificate — and the rules of its poolers. On the transaction pooler (port 6543) statements cannot
 * be prepared across queries: Drizzle's query builder, `execute()` and the migrator send unnamed statements and work
 * there; `.prepare(name)` on a query does not. The session pooler (port 5432) and the direct host take everything.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @example
 * ```ts
 * import { useDatabase } from '@novastarter/database';
 * import { DatabaseDriverSupabase } from '@novastarter/database-driver-supabase';
 * import { env } from './env';
 * import * as schema from './db/schema';
 *
 * const database = useDatabase();
 *
 * database.registerDriver('supabase', DatabaseDriverSupabase);
 * database.registerLocation('default', {
 * 	driver: 'supabase',
 * 	options: {
 * 		url: env.DATABASE_URL,
 * 		ca: env.DATABASE_SSL_CA,
 * 		schema,
 * 	},
 * });
 * ```
 */
export class DatabaseDriverSupabase<
	Schema extends Record<string, unknown> = Record<string, unknown>,
> extends DatabaseDriverPostgres<Schema> {
	/**
	 * What the dialect and the transport can do: sessions, so `db.transaction()` works.
	 *
	 * On the transaction pooler (port 6543, the default pooled URL) statements cannot be prepared across queries:
	 * `.prepare(name)` is rejected there, so Drizzle's relational query builder fails on a pooler URL even though
	 * plain transactions work. The session pooler (port 5432) and the direct host take everything.
	 */
	declare readonly capabilities: DatabaseCapabilities;

	/**
	 * Create a driver over a pool on the project's connection string.
	 *
	 * @param config - URL, TLS, pool, schema and logging options.
	 * @throws Error when `url` is missing, is not a valid URL, or carries an `sslmode` parameter.
	 */
	constructor(config: DatabaseDriverSupabaseConfig<Schema>) {
		// 1. The mapping checks the URL and throws before any pool exists; the Postgres driver does the rest
		super(toPostgresConfig(config));
	}
}
