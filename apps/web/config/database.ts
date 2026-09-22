import type { DatabaseDrivers } from '@novastarter/database';
import type { LocationConfig } from '@novastarter/utils';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import type { AppEnv } from '../env';

/**
 * What `useDatabase().location()` hands out: the Drizzle database the five Postgres drivers the app ships share —
 * node-postgres, Supabase, both Neon transports and PGlite all extend `PgDatabase` — typed with the app's schema, so
 * `db.query.users` and the query builder know the tables. `$client` differs per driver (a `pg` pool, a Neon pool, a
 * query function, a PGlite instance) and is not part of it.
 */
declare module '@novastarter/database' {
	interface DatabaseLocations {
		default: PgDatabase<PgQueryResultHKT, typeof schema>;
	}
}

/**
 * The `default` database location: the PostgreSQL the app reaches, or PGlite in-process without one.
 *
 * The in-process fallback of memory and queue, for the database: a Drizzle schema is bound to its dialect, and PGlite
 * is Postgres, so the app's `pgTable` schema and its migrations run unchanged on it — development and tests need no
 * server, and the data persists under `DATABASE_PGLITE_DIR`.
 *
 * @param env - The app's variables.
 * @returns The location to register.
 */
export const databaseConfig = (env: AppEnv): LocationConfig<DatabaseDrivers> => {
	// 1. No URL: Postgres inside the process, on the configured directory
	if (!env.DATABASE_URL) {
		return {
			driver: 'pglite',
			options: {
				connection: env.DATABASE_PGLITE_DIR,
				schema,
			},
		};
	}

	// 2. Supabase gets its driver, so TLS is on and the project's certificate is verified
	if (env.DATABASE_DRIVER === 'supabase') {
		return {
			driver: 'supabase',
			options: {
				url: env.DATABASE_URL,
				ca: env.DATABASE_SSL_CA,
				schema,
			},
		};
	}

	// 3. Neon over WebSocket or HTTP, for a deployment without TCP sockets; the console string works for both
	if (env.DATABASE_DRIVER === 'neon' || env.DATABASE_DRIVER === 'neon-http') {
		return {
			driver: env.DATABASE_DRIVER,
			options: {
				connection: env.DATABASE_URL,
				schema,
			},
		};
	}

	// 4. Anything else is plain node-postgres on the URL alone
	return {
		driver: 'postgres',
		options: {
			connection: env.DATABASE_URL,
			schema,
		},
	};
};
