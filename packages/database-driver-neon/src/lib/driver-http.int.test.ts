/**
 * The Neon HTTP driver against a real project; skipped unless `NEON_DATABASE_URL` names one — the same console
 * connection string the pool driver takes.
 *
 * What the mocked unit tests cannot see: that a query goes through Neon's HTTP endpoint, that a transaction is
 * refused while a batch runs, and that the migrator works statement by statement.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverNeonHttp } from './driver-http.js';

const NEON_DATABASE_URL = process.env['NEON_DATABASE_URL'];

describe.skipIf(!NEON_DATABASE_URL)('DatabaseDriverNeonHttp on Neon', () => {
	const schema = `novastarter_test_http_${process.pid}`;
	const logger = { error: vi.fn(), debug: vi.fn() };
	let driver: DatabaseDriverNeonHttp;
	let migrationsFolder: string;

	// The driver is built inside the hook, like every suite on a backend, so the describe body stays free of I/O
	beforeAll(async () => {
		driver = new DatabaseDriverNeonHttp({ connection: NEON_DATABASE_URL!, logger: logger as never });

		// The fixture table the batch below writes is made here, not by the migration: every test must pass run
		// alone, under `vitest -t` as well as whole-file
		await driver.db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`));

		await driver.db.execute(
			sql.raw(
				`CREATE TABLE IF NOT EXISTS "${schema}"."notes" ("id" serial PRIMARY KEY NOT NULL, "text" text NOT NULL)`,
			),
		);

		// The drizzle-kit folder is written per run, since the schema name carries the pid
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
		// real failure stays the one reported. There is no `close`: a fetch per query holds no connection
		if (driver) {
			await driver.db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
		}

		if (migrationsFolder) {
			await rm(migrationsFolder, { recursive: true, force: true });
		}
	});

	test('ping reaches the project over HTTP', async () => {
		await expect(driver.ping()).resolves.toBeUndefined();
	});

	test('migrate applies the folder once and records it in the journal schema', async () => {
		await driver.migrate({ migrationsFolder, migrationsSchema: schema });
		await driver.migrate({ migrationsFolder, migrationsSchema: schema });

		const rows = await driver.db.execute(
			sql.raw(`SELECT count(*)::int AS count FROM "${schema}"."__drizzle_migrations"`),
		);

		expect(rows.rows).toStrictEqual([{ count: 1 }]);
	});

	test('A transaction is refused while a batch goes through', async () => {
		// No session over HTTP, so Drizzle refuses the callback form up front
		await expect(driver.db.transaction(async () => {})).rejects.toThrow(/No transactions support/);

		// A batch is one request and one non-interactive transaction
		const [, rows] = await driver.db.batch([
			driver.db.execute(sql.raw(`INSERT INTO "${schema}"."notes" ("text") VALUES ('batched')`)),
			driver.db.execute(sql.raw(`SELECT "text" FROM "${schema}"."notes"`)),
		]);

		expect(rows.rows).toStrictEqual([{ text: 'batched' }]);
	});
});
