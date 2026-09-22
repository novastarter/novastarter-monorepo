import type { DatabaseDrivers } from '@novastarter/database';
import type { LocationConfig } from '@novastarter/utils';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { AppEnv } from '../env';

/**
 * What `useDatabase().location()` hands out: the Drizzle database the four Postgres drivers the app ships share —
 * node-postgres, Supabase and both Neon transports all extend `PgDatabase`. `$client` differs per driver (a `pg` pool,
 * a Neon pool, a query function) and is not part of it. The schema type joins as the second parameter —
 * `PgDatabase<PgQueryResultHKT, typeof schema>` — once the app defines its tables.
 */
declare module '@novastarter/database' {
	interface DatabaseLocations {
		default: PgDatabase<PgQueryResultHKT>;
	}
}

/**
 * The `default` database location: the PostgreSQL the app reaches, when it has one.
 *
 * No in-process fallback, unlike memory and queue: a Drizzle schema is bound to its dialect, so an app written for
 * PostgreSQL cannot fall back to SQLite. Without a `DATABASE_URL` the location is not registered and `location()`
 * throws.
 *
 * @param env - The app's variables.
 * @returns The location to register; `undefined` without a `DATABASE_URL`.
 */
export const databaseConfig = (env: AppEnv): LocationConfig<DatabaseDrivers> | undefined => {
	// 1. No URL, no location: registering one would only move the failure to the first query
	if (!env.DATABASE_URL) {
		return undefined;
	}

	// 2. Supabase gets its driver, so TLS is on and the project's certificate is verified
	if (env.DATABASE_DRIVER === 'supabase') {
		return {
			driver: 'supabase',
			options: {
				url: env.DATABASE_URL,
				ca: env.DATABASE_SSL_CA,
			},
		};
	}

	// 3. Neon over WebSocket or HTTP, for a deployment without TCP sockets; the console string works for both
	if (env.DATABASE_DRIVER === 'neon' || env.DATABASE_DRIVER === 'neon-http') {
		return {
			driver: env.DATABASE_DRIVER,
			options: {
				connection: env.DATABASE_URL,
			},
		};
	}

	// 4. Anything else is plain node-postgres on the URL alone
	return {
		driver: 'postgres',
		options: {
			connection: env.DATABASE_URL,
		},
	};
};
