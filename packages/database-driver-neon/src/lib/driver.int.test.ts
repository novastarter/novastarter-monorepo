/**
 * The Neon pool driver against a real project; skipped unless `NEON_DATABASE_URL` names one — the console's
 * connection string (`postgresql://…@ep-….neon.tech/neondb?sslmode=require`).
 *
 * What the mocked unit tests cannot see: that the WebSocket tunnel opens on the runtime's own `WebSocket`, that a
 * transaction runs on one session, and that the migrator works over it.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverNeon } from './driver.js';

const NEON_DATABASE_URL = process.env['NEON_DATABASE_URL'];

describe.skipIf(!NEON_DATABASE_URL)('DatabaseDriverNeon on Neon', () => {
	const schema = `novastarter_test_${process.pid}`;
	const logger = { error: vi.fn(), debug: vi.fn() };
	let driver: DatabaseDriverNeon;
	let migrationsFolder: string;

	// The pool is opened inside the hook: the describe body runs at collection even when the suite is skipped
	beforeAll(async () => {
		driver = new DatabaseDriverNeon({ connection: NEON_DATABASE_URL!, logger: logger as never });

		// 1. A drizzle-kit folder of one migration, written per run: the schema name carries the pid, so two runs on
		//    the same project never touch each other's tables
		migrationsFolder = await mkdtemp(join(tmpdir(), 'novastarter-migrations-'));
		await mkdir(join(migrationsFolder, 'meta'));

		await writeFile(
			join(migrationsFolder, 'meta', '_journal.json'),
			JSON.stringify({
				version: '7',
				dialect: 'postgresql',
				entries: [{ idx: 0, version: '7', when: Date.now(), tag: '0000_init', breakpoints: true }],
			}),
		);

		await writeFile(
			join(migrationsFolder, '0000_init.sql'),
			`CREATE TABLE "${schema}"."notes" ("id" serial PRIMARY KEY NOT NULL, "text" text NOT NULL);`,
		);
	});

	afterAll(async () => {
		await driver.db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
		await driver.close();
		await rm(migrationsFolder, { recursive: true, force: true });
	});

	test('ping reaches the project over WebSocket', async () => {
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

	test('A transaction runs on one session and rolls back on failure', async () => {
		// 1. The insert inside a failing transaction must not survive it
		await expect(
			driver.db.transaction(async (tx) => {
				await tx.execute(sql.raw(`INSERT INTO "${schema}"."notes" ("text") VALUES ('rolled back')`));
				throw new Error('abort');
			}),
		).rejects.toThrow('abort');

		const rows = await driver.db.execute(sql.raw(`SELECT count(*)::int AS count FROM "${schema}"."notes"`));

		expect(rows.rows).toStrictEqual([{ count: 0 }]);
	});
});
