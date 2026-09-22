/**
 * Apply the pending migrations to the app's database: `pnpm --filter web db:migrate`.
 *
 * The deploy step for a server database; in development, `DATABASE_MIGRATE=true` does the same at start-up.
 */
import { useLogger } from '@novastarter/logger';
import { bootstrap, shutdown } from '../bootstrap';
import { migrateDatabase } from '../db/migrate';

// 1. Wire the managers from the environment, so the `default` location and the app's logger exist
bootstrap();

// 2. Apply what is pending, then release the pool so the process can exit; a failure rejects and Node exits non-zero
try {
	await migrateDatabase();
	useLogger().info('Database migrations applied');
} finally {
	await shutdown();
}
