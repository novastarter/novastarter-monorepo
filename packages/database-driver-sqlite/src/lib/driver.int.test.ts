/**
 * The SQLite driver on a real better-sqlite3 database in memory: no service is needed, so the suite always runs.
 *
 * What the mocked unit tests cannot see: that the native addon loads, that Drizzle's migrator reads a drizzle-kit
 * folder and records what it ran, that the pragmas took, and that a statement round-trips through `db`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverSqlite, MEMORY_FILE } from './driver.js';

describe('DatabaseDriverSqlite in memory', () => {
	const logger = { error: vi.fn(), debug: vi.fn() };
	let driver: DatabaseDriverSqlite;
	let migrationsFolder: string;

	// The database is opened inside the hook, like every suite on a backend, so the describe body stays free of I/O
	beforeAll(async () => {
		driver = new DatabaseDriverSqlite({ file: MEMORY_FILE, logger: logger as never });

		// 1. A drizzle-kit folder of one migration, in the layout `drizzle-kit generate` writes
		migrationsFolder = await mkdtemp(join(tmpdir(), 'novastarter-migrations-'));
		await mkdir(join(migrationsFolder, 'meta'));

		await writeFile(
			join(migrationsFolder, 'meta', '_journal.json'),
			JSON.stringify({
				version: '7',
				dialect: 'sqlite',
				entries: [{ idx: 0, version: '7', when: Date.now(), tag: '0000_init', breakpoints: true }],
			}),
		);

		await writeFile(
			join(migrationsFolder, '0000_init.sql'),
			'CREATE TABLE `notes` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `text` text NOT NULL);',
		);
	});

	afterAll(async () => {
		await driver.close();
		await rm(migrationsFolder, { recursive: true, force: true });
	});

	test('ping answers', async () => {
		await expect(driver.ping()).resolves.toBeUndefined();
	});

	test('The pragmas took: foreign keys on, no WAL in memory', () => {
		// 1. Read back through the handle Drizzle exposes, the way an application would
		expect(driver.db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(driver.db.$client.pragma('journal_mode', { simple: true })).toBe('memory');
	});

	test('migrate applies the folder once and records it in the journal table', async () => {
		await driver.migrate({ migrationsFolder });

		expect(driver.db.all(sql`SELECT count(*) AS count FROM __drizzle_migrations`)).toStrictEqual([{ count: 1 }]);

		// 1. A second run finds nothing pending: the same migration is not applied again
		await driver.migrate({ migrationsFolder });

		expect(driver.db.all(sql`SELECT count(*) AS count FROM __drizzle_migrations`)).toStrictEqual([{ count: 1 }]);
	});

	test('Statements round-trip through db', () => {
		driver.db.run(sql`INSERT INTO notes (text) VALUES ('hello')`);

		expect(driver.db.all(sql`SELECT text FROM notes`)).toStrictEqual([{ text: 'hello' }]);
	});
});
