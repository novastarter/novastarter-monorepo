import type { DatabaseDrivers } from '@novastarter/database';
import type { LocationConfig } from '@novastarter/utils';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { AppEnv } from '../env';

/**
 * What `useDatabase().location()` hands out: both drivers the app ships expose Drizzle's node-postgres database. The
 * schema type joins here — `NodePgDatabase<typeof schema>` — once the app defines its tables.
 */
declare module '@novastarter/database' {
	interface DatabaseLocations {
		default: NodePgDatabase & { $client: Pool };
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

	// 2. Supabase gets its driver, so TLS is on and the project's certificate is verified; anything else is plain
	//    node-postgres on the URL alone
	if (env.DATABASE_DRIVER === 'supabase') {
		return {
			driver: 'supabase',
			options: {
				url: env.DATABASE_URL,
				ca: env.DATABASE_SSL_CA,
			},
		};
	}

	return {
		driver: 'postgres',
		options: {
			connection: env.DATABASE_URL,
		},
	};
};
