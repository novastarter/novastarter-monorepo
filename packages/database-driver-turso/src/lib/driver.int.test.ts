/**
 * The Turso driver on a real libSQL: a local file and a database in memory need no service, so those suites always
 * run; the remote one is skipped unless `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` name a Turso database.
 *
 * What the mocked unit tests cannot see: that the native binding loads and opens a file in a directory that did not
 * exist, that Drizzle's migrator batches a drizzle-kit folder onto it, that a transaction rolls back and a batch
 * commits, and — remotely — that the same goes over HTTPS.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverTurso, MEMORY_URL } from './driver.js';

const TURSO_DATABASE_URL = process.env['TURSO_DATABASE_URL'];
const TURSO_AUTH_TOKEN = process.env['TURSO_AUTH_TOKEN'];

/**
 * Write a drizzle-kit folder of one migration creating a notes table, in the layout `drizzle-kit generate` writes.
 *
 * @param table - Name of the table the migration creates.
 * @returns The folder; the caller removes it.
 */
const writeMigrations = async (table: string): Promise<string> => {
	// 1. A fresh folder per suite, so two suites of this file cannot share a journal
	const folder = await mkdtemp(join(tmpdir(), 'novastarter-migrations-'));
	await mkdir(join(folder, 'meta'));

	await writeFile(
		join(folder, 'meta', '_journal.json'),
		JSON.stringify({
			version: '7',
			dialect: 'sqlite',
			entries: [{ idx: 0, version: '7', when: Date.now(), tag: '0000_init', breakpoints: true }],
		}),
	);

	await writeFile(
		join(folder, '0000_init.sql'),
		`CREATE TABLE \`${table}\` (\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL, \`text\` text NOT NULL);`,
	);

	return folder;
};

describe('DatabaseDriverTurso on a local file', () => {
	const logger = { error: vi.fn(), debug: vi.fn() };
	let root: string;
	let driver: DatabaseDriverTurso;
	let migrationsFolder: string;

	// The file is opened inside the hook, like every suite on a backend; its parent directory does not exist yet, so
	// the recursive creation is proven
	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), 'novastarter-turso-'));
		driver = new DatabaseDriverTurso({ connection: `file:${join(root, 'nested', 'app.db')}`, logger: logger as never });
		migrationsFolder = await writeMigrations('notes');
	});

	afterAll(async () => {
		await driver.close();
		await rm(root, { recursive: true, force: true });
		await rm(migrationsFolder, { recursive: true, force: true });
	});

	test('ping answers', async () => {
		await expect(driver.ping()).resolves.toBeUndefined();
	});

	test('migrate applies the folder once and records it in the journal table', async () => {
		await driver.migrate({ migrationsFolder });
		await driver.migrate({ migrationsFolder });

		expect(await driver.db.all(sql`SELECT count(*) AS count FROM __drizzle_migrations`)).toStrictEqual([{ count: 1 }]);
	});

	test('A transaction rolls back on failure', async () => {
		// 1. The insert inside a failing transaction must not survive it
		await expect(
			driver.db.transaction(async (tx) => {
				await tx.run(sql`INSERT INTO notes (text) VALUES ('rolled back')`);
				throw new Error('abort');
			}),
		).rejects.toThrow('abort');

		expect(await driver.db.all(sql`SELECT count(*) AS count FROM notes`)).toStrictEqual([{ count: 0 }]);
	});

	test('A batch runs as one transaction', async () => {
		const [, rows] = await driver.db.batch([
			driver.db.run(sql`INSERT INTO notes (text) VALUES ('batched')`),
			driver.db.all(sql`SELECT text FROM notes`),
		]);

		expect(rows).toStrictEqual([{ text: 'batched' }]);
	});

	test('close shuts the client down', async () => {
		await driver.close();

		expect(driver.db.$client.closed).toBe(true);
	});
});

describe('DatabaseDriverTurso in memory', () => {
	const logger = { error: vi.fn(), debug: vi.fn() };
	let driver: DatabaseDriverTurso;
	let migrationsFolder: string;

	beforeAll(async () => {
		driver = new DatabaseDriverTurso({ connection: MEMORY_URL, logger: logger as never });
		migrationsFolder = await writeMigrations('notes');
	});

	afterAll(async () => {
		await driver.close();
		await rm(migrationsFolder, { recursive: true, force: true });
	});

	test('Migrates and round-trips without a file', async () => {
		await driver.migrate({ migrationsFolder });
		await driver.db.run(sql`INSERT INTO notes (text) VALUES ('hello')`);

		expect(await driver.db.all(sql`SELECT text FROM notes`)).toStrictEqual([{ text: 'hello' }]);
	});
});

describe.skipIf(!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN)('DatabaseDriverTurso on Turso', () => {
	// SQLite has no schema to isolate a run in, so the table and the journal carry the pid instead
	const table = `notes_${process.pid}`;
	const migrationsTable = `__drizzle_migrations_${process.pid}`;
	const logger = { error: vi.fn(), debug: vi.fn() };
	let driver: DatabaseDriverTurso;
	let migrationsFolder: string;

	// The client is opened inside the hook: the describe body runs at collection even when the suite is skipped
	beforeAll(async () => {
		driver = new DatabaseDriverTurso({
			connection: { url: TURSO_DATABASE_URL!, authToken: TURSO_AUTH_TOKEN! },
			logger: logger as never,
		});

		migrationsFolder = await writeMigrations(table);
	});

	afterAll(async () => {
		await driver.db.run(sql.raw(`DROP TABLE IF EXISTS \`${table}\``));
		await driver.db.run(sql.raw(`DROP TABLE IF EXISTS \`${migrationsTable}\``));
		await driver.close();
		await rm(migrationsFolder, { recursive: true, force: true });
	});

	test('ping reaches the database over HTTPS', async () => {
		await expect(driver.ping()).resolves.toBeUndefined();

		expect(driver.db.$client.protocol).toBe('http');
	});

	test('migrate applies the folder once and records it in the journal table', async () => {
		await driver.migrate({ migrationsFolder, migrationsTable });
		await driver.migrate({ migrationsFolder, migrationsTable });

		expect(await driver.db.all(sql.raw(`SELECT count(*) AS count FROM \`${migrationsTable}\``))).toStrictEqual([
			{ count: 1 },
		]);
	});

	test('A transaction rolls back and a batch commits', async () => {
		await expect(
			driver.db.transaction(async (tx) => {
				await tx.run(sql.raw(`INSERT INTO \`${table}\` (text) VALUES ('rolled back')`));
				throw new Error('abort');
			}),
		).rejects.toThrow('abort');

		const [, rows] = await driver.db.batch([
			driver.db.run(sql.raw(`INSERT INTO \`${table}\` (text) VALUES ('batched')`)),
			driver.db.all(sql.raw(`SELECT text FROM \`${table}\``)),
		]);

		expect(rows).toStrictEqual([{ text: 'batched' }]);
	});
});
