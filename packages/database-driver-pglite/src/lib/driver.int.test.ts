/**
 * The PGlite driver on a real PGlite: Postgres boots inside the process, so no service is needed and the suite always
 * runs.
 *
 * What the mocked unit tests cannot see: that the WebAssembly Postgres comes up, that Drizzle's Postgres migrator
 * works on it, that a transaction rolls back, and that a data directory survives the instance that wrote it.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverPglite, MEMORY_DATA_DIR } from './driver.js';

/**
 * Write a drizzle-kit folder of one migration creating a table, in the layout `drizzle-kit generate` writes.
 *
 * @returns The folder; the caller removes it.
 */
const writeMigrations = async (): Promise<string> => {
	// 1. A fresh folder per suite, so two suites of this file cannot share a journal
	const folder = await mkdtemp(join(tmpdir(), 'novastarter-migrations-'));
	await mkdir(join(folder, 'meta'));

	await writeFile(
		join(folder, 'meta', '_journal.json'),
		JSON.stringify({
			version: '7',
			dialect: 'postgresql',
			entries: [{ idx: 0, version: '7', when: Date.now(), tag: '0000_init', breakpoints: true }],
		}),
	);

	// 2. The migration itself: a probe table nothing reads — the migrator running it and journaling it is the point
	await writeFile(join(folder, '0000_init.sql'), 'CREATE TABLE "probe" ("id" serial PRIMARY KEY NOT NULL);');

	return folder;
};

describe('DatabaseDriverPglite in memory', { timeout: 30_000 }, () => {
	const logger = { error: vi.fn(), debug: vi.fn() };
	let driver: DatabaseDriverPglite;
	let migrationsFolder: string;

	// The instance boots inside the hook, like every suite on a backend; the boot takes a while, hence the timeout
	beforeAll(async () => {
		driver = new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR, logger: logger as never });

		// 1. The fixture table the transaction below writes is made here, not by the migration: every test must pass
		//    run alone, under `vitest -t` as well as whole-file
		await driver.db.execute(
			sql`CREATE TABLE IF NOT EXISTS "notes" ("id" serial PRIMARY KEY NOT NULL, "text" text NOT NULL)`,
		);

		migrationsFolder = await writeMigrations();
	}, 60_000);

	afterAll(async () => {
		// 1. A hook that failed partway leaves the rest undefined; the teardown runs only what was created, so the
		//    real failure stays the one reported
		if (driver) {
			await driver.close();
		}

		if (migrationsFolder) {
			await rm(migrationsFolder, { recursive: true, force: true });
		}
	});

	test('ping waits for the boot and answers', async () => {
		await expect(driver.ping()).resolves.toBeUndefined();

		expect(driver.db.$client.ready).toBe(true);
	});

	test('migrate applies the folder once and records it in the journal schema', async () => {
		await driver.migrate({ migrationsFolder });
		await driver.migrate({ migrationsFolder });

		// 1. Drizzle's Postgres migrator keeps its journal under the `drizzle` schema
		const rows = await driver.db.execute(sql`SELECT count(*)::int AS count FROM "drizzle"."__drizzle_migrations"`);

		expect(rows.rows).toStrictEqual([{ count: 1 }]);
	});

	test('A transaction rolls back on failure and commits otherwise', async () => {
		// 1. The insert inside a failing transaction must not survive it
		await expect(
			driver.db.transaction(async (tx) => {
				await tx.execute(sql`INSERT INTO "notes" ("text") VALUES ('rolled back')`);
				throw new Error('abort');
			}),
		).rejects.toThrow('abort');

		expect((await driver.db.execute(sql`SELECT count(*)::int AS count FROM "notes"`)).rows).toStrictEqual([
			{ count: 0 },
		]);

		// 2. A committed one is there afterwards
		await driver.db.transaction(async (tx) => {
			await tx.execute(sql`INSERT INTO "notes" ("text") VALUES ('committed')`);
		});

		expect((await driver.db.execute(sql`SELECT "text" FROM "notes"`)).rows).toStrictEqual([{ text: 'committed' }]);
	});

	test('close shuts the instance down', async () => {
		await driver.close();

		expect(driver.db.$client.closed).toBe(true);
	});
});

describe('DatabaseDriverPglite on a directory', { timeout: 30_000 }, () => {
	const logger = { error: vi.fn(), debug: vi.fn() };
	let root: string;
	let directory: string;
	let migrationsFolder: string;

	beforeAll(async () => {
		// 1. The data directory sits under a parent that does not exist yet, so the recursive creation is proven
		root = await mkdtemp(join(tmpdir(), 'novastarter-pglite-'));
		directory = join(root, 'nested', 'pgdata');
		migrationsFolder = await writeMigrations();
	});

	afterAll(async () => {
		// 1. A hook that failed partway leaves the rest undefined; the teardown runs only what was created, so the
		//    real failure stays the one reported
		if (root) {
			await rm(root, { recursive: true, force: true });
		}

		if (migrationsFolder) {
			await rm(migrationsFolder, { recursive: true, force: true });
		}
	});

	test('The data survives the instance that wrote it', async () => {
		// 1. A first instance creates the directory, migrates and writes; `initdb` runs here, hence the suite timeout
		const first = new DatabaseDriverPglite({ connection: directory, logger: logger as never });

		await first.migrate({ migrationsFolder });

		// 2. The fixture table is made here, not by the migration: the write below stands on its own, whatever the
		//    migrator ran
		await first.db.execute(
			sql`CREATE TABLE IF NOT EXISTS "notes" ("id" serial PRIMARY KEY NOT NULL, "text" text NOT NULL)`,
		);

		await first.db.execute(sql`INSERT INTO "notes" ("text") VALUES ('kept')`);
		await first.close();

		// 3. A second instance on the same directory reads what the first one wrote
		const second = new DatabaseDriverPglite({ connection: directory, logger: logger as never });

		expect((await second.db.execute(sql`SELECT "text" FROM "notes"`)).rows).toStrictEqual([{ text: 'kept' }]);

		await second.close();
	}, 60_000);
});
