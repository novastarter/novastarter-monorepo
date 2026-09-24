import { join } from 'node:path';
import { useDatabase } from '@novastarter/database';

/**
 * The folder `drizzle-kit generate` writes: `apps/web/drizzle`, resolved against the working directory.
 *
 * The working directory rather than `import.meta.url`: `next dev` and `next start` run in `apps/web`, whereas the
 * bundled `instrumentation.ts` reports a URL inside `.next/`. A standalone build would need `outputFileTracingIncludes`
 * for `drizzle/**` to carry the folder along.
 *
 * @returns The absolute path of the migrations folder.
 */
export const migrationsFolder = (): string => join(process.cwd(), 'drizzle');

/**
 * Apply the pending migrations of {@link migrationsFolder} to the `default` database location.
 *
 * Through the manager, so the migrator runs on the driver and connection the app queries with — PGlite in
 * development, the server in production. Drizzle records what it ran, so calling this at every start is safe.
 *
 * @returns Once every pending migration ran.
 * @throws What the migrator raised — a failing statement, a missing folder.
 */
export const migrateDatabase = async (): Promise<void> => {
	// The location's own `migrate()` picks the migrator of its dialect
	await useDatabase().location().migrate({ migrationsFolder: migrationsFolder() });
};
