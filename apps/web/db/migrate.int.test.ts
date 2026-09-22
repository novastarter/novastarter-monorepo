/**
 * Integration test of the app's migrations on PGlite in memory: the committed `drizzle/` folder applies to the
 * `default` location the bootstrap registers, and the schema of `db/schema.ts` matches what it created. No service is
 * needed — PGlite boots inside the process — so the suite always runs.
 */
import { useDatabase } from '@novastarter/database';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { _state, bootstrap, shutdown } from '../bootstrap';
import { readEnv } from '../env';
import { migrateDatabase } from './migrate';
import { useDb, users } from './index';

describe('migrateDatabase on PGlite', { timeout: 30_000 }, () => {
	// The database boots inside the hook, like every suite on a backend; the boot takes a while, hence the timeout
	beforeAll(() => {
		vi.stubEnv('REDIS', '');
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('DATABASE_PGLITE_DIR', 'memory://');
		bootstrap();
	}, 60_000);

	afterAll(async () => {
		await shutdown();
		_state.booted = false;
		_state.handlers = false;
		readEnv.reset();
		useDatabase.reset();
		vi.unstubAllEnvs();
	});

	test('Applies the committed folder and the schema matches it', async () => {
		// 1. Twice, so a second start finds nothing pending
		await migrateDatabase();
		await migrateDatabase();

		// 2. A row through the typed schema proves the table the migration created is the one `db/schema.ts` describes
		const db = useDb();

		await db.insert(users).values({ email: 'ada@example.com', name: 'Ada' });

		const people = await db.query.users.findMany();

		expect(people).toHaveLength(1);
		expect(people[0]).toMatchObject({ id: 1, email: 'ada@example.com', name: 'Ada' });
		expect(people[0]?.createdAt).toBeInstanceOf(Date);
	});
});
