/**
 * The Postgres driver against a real server; skipped unless `POSTGRES` names one
 * (`POSTGRES=postgresql://postgres:secret@127.0.0.1:5432/postgres`).
 *
 * What the mocked unit tests cannot see: that the pool really connects, that Drizzle's migrator reads a drizzle-kit
 * folder and records what it ran, and that a query round-trips through `db`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverPostgres } from './driver.js';

const POSTGRES = process.env['POSTGRES'];

describe.skipIf(!POSTGRES)('DatabaseDriverPostgres on Postgres', () => {
	const schema = `novastarter_test_${process.pid}`;
	const logger = { error: vi.fn(), debug: vi.fn() };
	let driver: DatabaseDriverPostgres;
	let migrationsFolder: string;

	// The pool is opened inside the hook: the describe body runs at collection even when the suite is skipped
	beforeAll(async () => {
		driver = new DatabaseDriverPostgres({ connection: POSTGRES!, logger: logger as never });

		// The fixture table the queries below write is made here, not by the migration: every test must pass run
		// alone, under `vitest -t` as well as whole-file
		await driver.db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`));

		await driver.db.execute(
			sql.raw(
				`CREATE TABLE IF NOT EXISTS "${schema}"."notes" ("id" serial PRIMARY KEY NOT NULL, "text" text NOT NULL)`,
			),
		);

		// The drizzle-kit folder is written per run: the schema name carries the pid, so two runs on the same server
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

	test('ping reaches the server', async () => {
		await expect(driver.ping()).resolves.toBeUndefined();
	});

	test('migrate applies the folder once and records it in the journal schema', async () => {
		await driver.migrate({ migrationsFolder, migrationsSchema: schema });

		const rows = await driver.db.execute(
			sql.raw(`SELECT count(*)::int AS count FROM "${schema}"."__drizzle_migrations"`),
		);

		expect(rows.rows).toStrictEqual([{ count: 1 }]);

		// A second run finds nothing pending: the same migration is not applied again
		await driver.migrate({ migrationsFolder, migrationsSchema: schema });

		const again = await driver.db.execute(
			sql.raw(`SELECT count(*)::int AS count FROM "${schema}"."__drizzle_migrations"`),
		);

		expect(again.rows).toStrictEqual([{ count: 1 }]);
	});

	test('Queries round-trip through db', async () => {
		await driver.db.execute(sql.raw(`INSERT INTO "${schema}"."notes" ("text") VALUES ('hello')`));

		const rows = await driver.db.execute(sql.raw(`SELECT "text" FROM "${schema}"."notes"`));

		expect(rows.rows).toStrictEqual([{ text: 'hello' }]);
	});
});
