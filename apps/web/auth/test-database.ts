/**
 * Test support of the `auth/*.int.test.ts` suites: the `default` database location on PGlite in memory, migrated
 * with the app's own `drizzle/` folder, the in-process `default` cache, and auth settings with secrets long enough to be
 * accepted.
 *
 * Not imported by the app; it lives next to the suites that share it, so each of them stays about its own module.
 */
import { useAuth } from '@novastarter/auth';
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverPglite } from '@novastarter/database-driver-pglite';
import { useCache } from '@novastarter/memory';
import { sql } from 'drizzle-orm';
import { databaseConfig } from '../config/database';
import { useDb } from '../db';
import { migrateDatabase } from '../db/migrate';
import { envSchema } from '../env';

/**
 * A secret of 32 characters and more, the shortest the auth settings accept.
 */
export const TEST_SECRET = 'test-secret-of-at-least-thirty-two-characters';

/**
 * Boot PGlite in memory as the `default` location, apply the app's migrations and register the auth settings.
 *
 * The location comes from the app's own `databaseConfig`, so the tests query the schema and driver the app boots on;
 * the variables are parsed from a fixed object rather than the shell, so a `DATABASE_URL` there cannot redirect them.
 *
 * @returns Once the tables exist.
 */
export const bootTestDatabase = async (): Promise<void> => {
	// PGlite in memory: a real Postgres in the process, gone with it, so the suite needs no service
	useDatabase().registerDriver('pglite', DatabaseDriverPglite);
	useDatabase().registerLocation('default', databaseConfig(envSchema.parse({ DATABASE_PGLITE_DIR: 'memory://' })));

	// The committed migrations, so a schema that drifted from them fails here rather than in production
	await migrateDatabase();

	// The in-process cache the sessions module reads through, as the app boots without a Redis
	useCache().registerLocation('default', { driver: 'local', options: {} });

	// Secrets for every feature under test; no limiters, which the suites add where they test them
	useAuth().registerSettings({
		jwt: { secret: TEST_SECRET },
		mfa: { issuer: 'Test', encryptionKey: TEST_SECRET },
		oauth: { secret: TEST_SECRET },
	});
};

/**
 * Empty every auth table and the cache between tests, so no record leaks from one test into the next.
 *
 * @returns Once the tables are empty.
 */
export const clearAuthTables = async (): Promise<void> => {
	// One statement for all five tables; far cheaper than booting PGlite again
	await useDb().execute(sql`TRUNCATE auth_sessions, auth_tokens, auth_refresh_tokens, auth_mfa, auth_recovery_codes`);

	// The cached sessions go with their rows, so a test never reads a copy an earlier one left behind
	await useCache().location().clear();
};

/**
 * Close PGlite and forget the database, cache and auth registrations, so the next suite starts from nothing.
 *
 * @returns Once the database is closed.
 */
export const closeTestDatabase = async (): Promise<void> => {
	// Close before resetting: a reset manager would no longer know the instance to close
	await useDatabase().close();
	useDatabase.reset();
	useAuth.reset();
	useCache.reset();
};
