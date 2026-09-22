/**
 * The D1 driver on a real D1 over wrangler's platform proxy; skipped unless `D1_CONFIG` names a wrangler config
 * with a d1 binding (`D1_CONFIG=./wrangler.jsonc`).
 *
 * What the mocked unit tests cannot see: that the platform proxy serves the binding, that Drizzle's D1 migrator
 * batches a drizzle-kit folder onto it, and that a statement round-trips through `db`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { DatabaseDriverD1 } from './driver.js';

const D1_CONFIG = process.env['D1_CONFIG'];

/**
 * Tell a D1 binding from the other values of a wrangler env: D1 answers the five methods of its API, and nothing
 * else in a wrangler env does.
 *
 * @param value - A binding of the wrangler config's env.
 * @returns Whether the value is a D1 binding.
 */
const isD1Database = (value: unknown): value is D1Database => {
	// 1. A binding is an object; anything else in the env — strings, functions — cannot be a database
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	// 2. The D1 API is the five methods; a binding answering all of them is the database
	return ['prepare', 'batch', 'exec', 'withSession', 'dump'].every((method) => method in value);
};

describe.skipIf(!D1_CONFIG)('DatabaseDriverD1 on D1', () => {
	// D1 is SQLite, with no schema to isolate a run in, so the table and the journal carry the pid instead
	const table = `notes_${process.pid}`;
	const migrationsTable = `__drizzle_migrations_${process.pid}`;
	const logger = { error: vi.fn(), debug: vi.fn() };
	let driver: DatabaseDriverD1;
	let migrationsFolder: string;
	let dispose: () => Promise<void>;

	// The proxy and the driver are opened inside the hook: the describe body runs at collection even when the suite
	// is skipped
	beforeAll(async () => {
		// 1. The platform proxy serves the app's wrangler config locally; the D1 binding is the one in its env that
		//    answers D1's API. The env var is read at module scope, so the suite's guard narrows nothing in here
		const proxy = await getPlatformProxy({ configPath: D1_CONFIG! });
		const binding = Object.values(proxy.env).find(isD1Database);

		if (!binding) {
			throw new Error(`The wrangler config ${D1_CONFIG} names no D1 binding`);
		}

		dispose = proxy.dispose;
		driver = new DatabaseDriverD1({ binding, logger: logger as never });

		// 2. A drizzle-kit folder of one migration, written per run, since the table name carries the pid
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
			`CREATE TABLE \`${table}\` (\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL, \`text\` text NOT NULL);`,
		);
	});

	afterAll(async () => {
		// 1. The pid-scoped tables go, so two runs on the same database never meet each other's fixtures
		await driver.db.run(sql.raw(`DROP TABLE IF EXISTS \`${table}\``));
		await driver.db.run(sql.raw(`DROP TABLE IF EXISTS \`${migrationsTable}\``));

		// 2. The folder is a temp one of this run; then the proxy's process follows
		await rm(migrationsFolder, { recursive: true, force: true });
		await dispose();
	});

	test('ping answers', async () => {
		await expect(driver.ping()).resolves.toBeUndefined();
	});

	test('migrate applies the folder once and records it in the journal table', async () => {
		await driver.migrate({ migrationsFolder, migrationsTable });

		expect(await driver.db.all(sql.raw(`SELECT count(*) AS count FROM \`${migrationsTable}\``))).toStrictEqual([
			{ count: 1 },
		]);

		// 1. A second run finds nothing pending: the same migration is not applied again
		await driver.migrate({ migrationsFolder, migrationsTable });

		expect(await driver.db.all(sql.raw(`SELECT count(*) AS count FROM \`${migrationsTable}\``))).toStrictEqual([
			{ count: 1 },
		]);
	});

	test('Statements round-trip through db', async () => {
		await driver.db.run(sql.raw(`INSERT INTO \`${table}\` (\`text\`) VALUES ('hello')`));

		expect(await driver.db.all(sql.raw(`SELECT \`text\` FROM \`${table}\``))).toStrictEqual([{ text: 'hello' }]);
	});
});
