/**
 * Apply the pending migrations to the app's database: `pnpm --filter web db:migrate`.
 *
 * The deploy step for a server database; in development, `DATABASE_MIGRATE=true` does the same at start-up.
 */
import { useLogger } from '@novastarter/logger';
import { toError } from '@novastarter/utils';
import { bootstrap, shutdown } from '../bootstrap';
import { migrateDatabase } from '../db/migrate';

// 1. Wire the managers from the environment, so the `default` location and the app's logger exist
bootstrap();

// 2. Apply what is pending; the outcome is remembered so it survives whatever the shutdown below does
let failure: unknown;

try {
	await migrateDatabase();
	useLogger().info('Database migrations applied');
} catch (error) {
	// 3. The migration error stays the exit reason: the shutdown must run all the same, and its own failure must not
	//    hide the failing statement from the operator
	failure = error;
}

// 4. Release the pool so the process can exit — after a failure too; on the success path a shutdown failure still
//    rejects, since nothing else is wrong
try {
	await shutdown();
} catch (error) {
	if (failure !== undefined) {
		useLogger().error(toError(error), 'The shutdown after a failed migration refused to close');
	} else {
		throw error;
	}
}

// 5. A failed migration is rethrown last, so it — not a shutdown failure — is what the deploy step reports
if (failure !== undefined) {
	throw failure;
}
