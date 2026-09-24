/**
 * The MySQL driver against a real server; skipped unless `MYSQL` names one
 * (`MYSQL=mysql://root:secret@127.0.0.1:3306/app`).
 *
 * What the mocked unit tests cannot see: that the pool really connects, that Drizzle's migrator reads a drizzle-kit
 * folder and records what it ran, and that a query round-trips through `db`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverMysql } from './driver.js';

const MYSQL = process.env['MYSQL'];

describe.skipIf(!MYSQL)('DatabaseDriverMysql on MySQL', () => {
	// MySQL has no schema to isolate a run in, so the table and the journal carry the pid instead
	const table = `notes_${process.pid}`;
	const probeTable = `probe_${process.pid}`;
	const migrationsTable = `__drizzle_migrations_${process.pid}`;
	const logger = { error: vi.fn(), debug: vi.fn() };
	let driver: DatabaseDriverMysql;
	let migrationsFolder: string;

	// The pool is opened inside the hook: the describe body runs at collection even when the suite is skipped
	beforeAll(async () => {
		driver = new DatabaseDriverMysql({ connection: MYSQL!, logger: logger as never });

		// The fixture table the queries below write is made here, not by the migration: every test must pass run
		// alone, under `vitest -t` as well as whole-file
		await driver.db.execute(
			sql.raw(
				`CREATE TABLE IF NOT EXISTS \`${table}\` (\`id\` int AUTO_INCREMENT NOT NULL, \`text\` text NOT NULL, PRIMARY KEY (\`id\`))`,
			),
		);

		// The drizzle-kit folder is written per run, since the table name carries the pid
		migrationsFolder = await mkdtemp(join(tmpdir(), 'novastarter-migrations-'));
		await mkdir(join(migrationsFolder, 'meta'));

		await writeFile(
			join(migrationsFolder, 'meta', '_journal.json'),
			JSON.stringify({
				version: '5',
				dialect: 'mysql',
				entries: [{ idx: 0, version: '5', when: Date.now(), tag: '0000_init', breakpoints: true }],
			}),
		);

		// A probe table nothing reads: the migrator running it and journaling it is the point
		await writeFile(
			join(migrationsFolder, '0000_init.sql'),
			`CREATE TABLE \`${probeTable}\` (\`id\` int AUTO_INCREMENT NOT NULL, PRIMARY KEY (\`id\`));`,
		);
	});

	afterAll(async () => {
		// A hook that failed partway leaves the rest undefined; the teardown runs only what was created, so the
		// real failure stays the one reported
		if (driver) {
			// The pid-scoped tables go, so two runs on the same database never meet each other's fixtures
			await driver.db.execute(sql.raw(`DROP TABLE IF EXISTS \`${table}\``));
			await driver.db.execute(sql.raw(`DROP TABLE IF EXISTS \`${probeTable}\``));
			await driver.db.execute(sql.raw(`DROP TABLE IF EXISTS \`${migrationsTable}\``));
			await driver.close();
		}

		if (migrationsFolder) {
			await rm(migrationsFolder, { recursive: true, force: true });
		}
	});

	/**
	 * Read the rows of a statement; mysql2 answers `[rows, fields]` and Drizzle passes that pair through.
	 *
	 * @param statement - Raw SQL to run.
	 * @returns The rows the statement returned.
	 */
	const rows = async <T>(statement: string): Promise<T[]> => {
		const [result] = await driver.db.execute(sql.raw(statement));

		return result as unknown as T[];
	};

	test('ping reaches the server', async () => {
		await expect(driver.ping()).resolves.toBeUndefined();
	});

	test('migrate applies the folder once and records it in the journal table', async () => {
		await driver.migrate({ migrationsFolder, migrationsTable });

		expect(await rows<{ count: number }>(`SELECT count(*) AS count FROM \`${migrationsTable}\``)).toEqual([
			{ count: 1 },
		]);

		// A second run finds nothing pending: the same migration is not applied again
		await driver.migrate({ migrationsFolder, migrationsTable });

		expect(await rows<{ count: number }>(`SELECT count(*) AS count FROM \`${migrationsTable}\``)).toEqual([
			{ count: 1 },
		]);
	});

	test('Queries round-trip through db', async () => {
		await driver.db.execute(sql.raw(`INSERT INTO \`${table}\` (\`text\`) VALUES ('hello')`));

		expect(await rows<{ text: string }>(`SELECT \`text\` FROM \`${table}\``)).toEqual([{ text: 'hello' }]);
	});
});
