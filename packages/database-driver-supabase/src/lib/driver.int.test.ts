/**
 * The Supabase driver against a real project; skipped unless `SUPABASE_DATABASE_URL` names one — the dashboard's
 * connection string, direct or pooler — with `SUPABASE_DATABASE_CA` pointing at the project's root certificate file
 * when the server needs it.
 *
 * What the mocked unit tests cannot see: that TLS is negotiated with the defaults, that the pooler takes Drizzle's
 * unnamed statements, and that the migrator works on it.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverSupabase } from './driver.js';

const SUPABASE_DATABASE_URL = process.env['SUPABASE_DATABASE_URL'];
const SUPABASE_DATABASE_CA = process.env['SUPABASE_DATABASE_CA'];

describe.skipIf(!SUPABASE_DATABASE_URL)('DatabaseDriverSupabase on Supabase', () => {
	const schema = `novastarter_test_${process.pid}`;
	const logger = { error: vi.fn(), debug: vi.fn() };
	let driver: DatabaseDriverSupabase;
	let migrationsFolder: string;

	// The pool is opened inside the hook: the describe body runs at collection even when the suite is skipped
	beforeAll(async () => {
		// The certificate comes from a file, the way a deployment mounts it
		const ca = SUPABASE_DATABASE_CA ? await readFile(SUPABASE_DATABASE_CA, 'utf8') : undefined;

		driver = new DatabaseDriverSupabase({ url: SUPABASE_DATABASE_URL!, ca, logger: logger as never });

		// The fixture table the queries below write is made here, not by the migration: every test must pass run
		// alone, under `vitest -t` as well as whole-file
		await driver.db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`));

		await driver.db.execute(
			sql.raw(
				`CREATE TABLE IF NOT EXISTS "${schema}"."notes" ("id" serial PRIMARY KEY NOT NULL, "text" text NOT NULL)`,
			),
		);

		// The drizzle-kit folder is written per run: the schema name carries the pid, so two runs on the same project
		// never touch each other's tables
		migrationsFolder = await mkdtemp(join(tmpdir(), 'novastarter-migrations-'));
		await mkdir(join(migrationsFolder, 'meta'));

		// The migrator reads the journal to find what to apply
		await writeFile(
			join(migrationsFolder, 'meta', '_journal.json'),
			JSON.stringify({
				version: '7',
				dialect: 'postgresql',
				entries: [{ idx: 0, version: '7', when: Date.now(), tag: '0000_init', breakpoints: true }],
			}),
		);

		// A probe table nothing reads: the migrator running it and journaling it is the point
		await writeFile(
			join(migrationsFolder, '0000_init.sql'),
			`CREATE TABLE "${schema}"."probe" ("id" serial PRIMARY KEY NOT NULL);`,
		);
	});

	afterAll(async () => {
		// A hook that failed partway leaves the rest undefined; the teardown runs only what was created, so the
		// real failure stays the one reported
		if (driver) {
			await driver.db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
			await driver.close();
		}

		if (migrationsFolder) {
			await rm(migrationsFolder, { recursive: true, force: true });
		}
	});

	test('ping reaches the project over TLS', async () => {
		await expect(driver.ping()).resolves.toBeUndefined();
	});

	test('migrate applies the folder once on the pooler', async () => {
		await driver.migrate({ migrationsFolder, migrationsSchema: schema });
		await driver.migrate({ migrationsFolder, migrationsSchema: schema });

		const rows = await driver.db.execute(
			sql.raw(`SELECT count(*)::int AS count FROM "${schema}"."__drizzle_migrations"`),
		);

		expect(rows.rows).toStrictEqual([{ count: 1 }]);
	});

	test('Queries round-trip through db', async () => {
		await driver.db.execute(sql.raw(`INSERT INTO "${schema}"."notes" ("text") VALUES ('hello')`));

		const rows = await driver.db.execute(sql.raw(`SELECT "text" FROM "${schema}"."notes"`));

		expect(rows.rows).toStrictEqual([{ text: 'hello' }]);
	});
});
