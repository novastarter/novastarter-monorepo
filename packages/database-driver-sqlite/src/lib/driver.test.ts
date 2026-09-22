/**
 * Tests of `database-driver-sqlite/lib/driver`.
 */
import { mkdirSync } from 'node:fs';
import { randDirectoryPath, randFileName } from '@ngneat/falso';
import { DatabaseUnavailableError } from '@novastarter/database';
import { useLogger } from '@novastarter/logger';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverSqlite, MEMORY_FILE } from './driver.js';

// A factory rather than an automock of `better-sqlite3`: automocking would load the native addon first
vi.mock('better-sqlite3', () => ({
	default: vi.fn(function () {
		return { pragma: vi.fn(), close: vi.fn() };
	}),
}));

vi.mock('node:fs');
vi.mock('@novastarter/logger', () => ({ useLogger: vi.fn() }));
vi.mock('drizzle-orm/better-sqlite3', () => ({ drizzle: vi.fn() }));
vi.mock('drizzle-orm/better-sqlite3/migrator', () => ({ migrate: vi.fn() }));

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	directory: string;
	file: string;
	folder: string;
	logger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; child: ReturnType<typeof vi.fn> };
	processLogger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	db: { run: ReturnType<typeof vi.fn> };
};

/**
 * The handle the mocked `better-sqlite3` constructor answered with, for the driver built last.
 */
const lastHandle = () => vi.mocked(Database).mock.results.at(-1)!.value as { pragma: ReturnType<typeof vi.fn> };

beforeEach(() => {
	// 1. Fresh values per test; the file sits in a directory, so the directory creation has something to do
	const directory = randDirectoryPath();

	sample = {
		directory,
		file: `${directory}/${randFileName()}.db`,
		folder: randDirectoryPath(),
		logger: { error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
		processLogger: { error: vi.fn(), debug: vi.fn() },
		db: { run: vi.fn() },
	};

	// 2. `drizzle` answers a bare object: only `run` is called, and the migrator is mocked whole
	vi.mocked(drizzle).mockReturnValue(sample.db as unknown as BetterSQLite3Database & { $client: Database.Database });
	vi.mocked(useLogger).mockReturnValue(sample.processLogger as never);
});

afterEach(() => {
	// 1. Clear the call history, so a handle built in one test cannot be read by the next; the implementations stay,
	//    since the `better-sqlite3` factory above is what every test constructs its handle with
	vi.clearAllMocks();
});

describe('#constructor', () => {
	test('Throws when the file is missing', () => {
		// 1. Without one better-sqlite3 would open an anonymous database whose writes vanish at exit
		expect(() => new DatabaseDriverSqlite({ file: '' })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The sqlite database driver needs a "file"]`,
		);
	});

	test('Creates the directory and opens the file', () => {
		const driver = new DatabaseDriverSqlite({ file: sample.file, logger: sample.logger as never });

		// 1. The directory first, recursively, since better-sqlite3 cannot create it; then the file without options
		expect(mkdirSync).toHaveBeenCalledExactlyOnceWith(sample.directory, { recursive: true });
		expect(Database).toHaveBeenCalledExactlyOnceWith(sample.file);
		expect(driver['database']).toBe(lastHandle());
	});

	test('Passes the open options through', () => {
		const options = { readonly: true, timeout: 1000 };

		new DatabaseDriverSqlite({ file: sample.file, options, logger: sample.logger as never });

		expect(Database).toHaveBeenCalledExactlyOnceWith(sample.file, options);
	});

	test('Creates no directory for a database in memory', () => {
		new DatabaseDriverSqlite({ file: MEMORY_FILE, logger: sample.logger as never });

		expect(mkdirSync).not.toHaveBeenCalled();
		expect(Database).toHaveBeenCalledExactlyOnceWith(MEMORY_FILE);
	});

	test('Turns foreign keys and WAL on for a file by default', () => {
		new DatabaseDriverSqlite({ file: sample.file, logger: sample.logger as never });

		expect(lastHandle().pragma).toHaveBeenCalledWith('foreign_keys = ON');
		expect(lastHandle().pragma).toHaveBeenCalledWith('journal_mode = WAL');
	});

	test('Turns foreign keys on but not WAL for a database in memory', () => {
		new DatabaseDriverSqlite({ file: MEMORY_FILE, logger: sample.logger as never });

		expect(lastHandle().pragma).toHaveBeenCalledExactlyOnceWith('foreign_keys = ON');
	});

	test('Honours the pragma options either way', () => {
		// 1. Both off for a file: no pragma at all
		new DatabaseDriverSqlite({ file: sample.file, foreignKeys: false, wal: false, logger: sample.logger as never });

		expect(lastHandle().pragma).not.toHaveBeenCalled();

		// 2. WAL asked for in memory: the driver does what it is told
		new DatabaseDriverSqlite({ file: MEMORY_FILE, wal: true, logger: sample.logger as never });

		expect(lastHandle().pragma).toHaveBeenCalledWith('journal_mode = WAL');
	});

	test('Leaves WAL off for a file opened readonly', () => {
		// 1. SQLite answers the WAL attempt on a read-only file with SQLITE_READONLY, so the default keeps it off there
		new DatabaseDriverSqlite({ file: sample.file, options: { readonly: true }, logger: sample.logger as never });

		expect(lastHandle().pragma).toHaveBeenCalledExactlyOnceWith('foreign_keys = ON');
	});

	test('Does what it is told when WAL is asked for on a read-only file', () => {
		// 1. An explicit wal: true stands, as in memory: the driver's contract is to run the pragma it was given
		new DatabaseDriverSqlite({
			file: sample.file,
			options: { readonly: true },
			wal: true,
			logger: sample.logger as never,
		});

		expect(lastHandle().pragma).toHaveBeenCalledWith('journal_mode = WAL');
	});

	test('Closes the handle when a pragma throws', () => {
		// 1. What SQLite answers on a read-only file asked for WAL
		const error = new Error('attempt to write a readonly database');

		vi.mocked(Database).mockImplementationOnce(
			() =>
				({
					pragma: vi.fn(() => {
						throw error;
					}),
					close: vi.fn(),
				}) as unknown as Database.Database,
		);

		// 2. The constructor rethrows the pragma's error; the handle opened a moment ago is closed with it. Foreign
		//    keys stay off, so the throwing call is the WAL pragma itself
		expect(
			() =>
				new DatabaseDriverSqlite({
					file: sample.file,
					foreignKeys: false,
					wal: true,
					logger: sample.logger as never,
				}),
		).toThrow(error);

		const handle = vi.mocked(Database).mock.results.at(-1)!.value as { close: ReturnType<typeof vi.fn> };

		expect(handle.close).toHaveBeenCalledOnce();
	});

	test('Builds the Drizzle database over the handle with the schema and casing', () => {
		const schema = { notes: {} };

		const driver = new DatabaseDriverSqlite({
			file: sample.file,
			schema,
			casing: 'snake_case',
			logger: sample.logger as never,
		});

		// 1. Drizzle gets the handle and only the options that carry a value
		expect(drizzle).toHaveBeenCalledExactlyOnceWith(driver['database'], { schema, casing: 'snake_case' });
		expect(driver.db).toBe(sample.db);
	});

	test('Hands Drizzle a query logger on the process logger only when asked for', () => {
		new DatabaseDriverSqlite({ file: sample.file });

		// 1. Off by default: no logger key, so Drizzle makes no logger call per query
		expect(vi.mocked(drizzle).mock.calls[0]![1]).toStrictEqual({});

		new DatabaseDriverSqlite({ file: sample.file, queryLogging: true });

		// 2. On, without a logger of its own: the query logger reports to the process logger
		const options = vi.mocked(drizzle).mock.calls[1]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(sample.processLogger.debug).toHaveBeenCalledExactlyOnceWith(
			{ query: 'select 1', paramCount: 0 },
			'Database query',
		);
	});
});

describe('#capabilities', () => {
	test('Declares whether transactions work', () => {
		// 1. Sessions, so `db.transaction()` works; the flag is what an app reads instead of the driver name
		const driver = new DatabaseDriverSqlite({ file: MEMORY_FILE, logger: sample.logger as never });

		expect(driver.capabilities).toStrictEqual({ transactions: true });
	});
});

describe('#label', () => {
	test('Binds the label to the logger, so the query log names the location', () => {
		// 1. A labelled driver logs through a child carrying `database`; the query logger inherits it
		const child = { error: vi.fn(), debug: vi.fn() };
		const logger = { ...sample.logger, child: vi.fn().mockReturnValue(child) };

		new DatabaseDriverSqlite({ file: MEMORY_FILE, label: 'main', queryLogging: true, logger: logger as never });

		expect(logger.child).toHaveBeenCalledExactlyOnceWith({ database: 'main' });

		const options = vi.mocked(drizzle).mock.calls[0]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(child.debug).toHaveBeenCalledExactlyOnceWith({ query: 'select 1', paramCount: 0 }, 'Database query');
		expect(sample.logger.debug).not.toHaveBeenCalled();
	});

	test('Leaves the logger as it is without a label', () => {
		const logger = { ...sample.logger, child: vi.fn() };

		new DatabaseDriverSqlite({ file: MEMORY_FILE, logger: logger as never });

		expect(logger.child).not.toHaveBeenCalled();
	});
});

describe('#ping', () => {
	test('Runs select 1 through Drizzle', async () => {
		const driver = new DatabaseDriverSqlite({ file: MEMORY_FILE, logger: sample.logger as never });

		await driver.ping();

		// 1. Through `db.run`, so the same path the application's statements take is what gets proven
		expect(sample.db.run).toHaveBeenCalledExactlyOnceWith(sql`select 1`);
	});

	test('Wraps what the query raised in DatabaseUnavailableError, naming the location', async () => {
		const driver = new DatabaseDriverSqlite({ file: MEMORY_FILE, label: 'main', logger: sample.logger as never });
		const error = new Error('database is locked');

		sample.db.run.mockImplementation(() => {
			throw error;
		});

		// 1. One error for every backend: recognisable, 503, the location in the message, the backend's error as cause
		const thrown: unknown = await driver.ping().catch((caught: unknown) => caught);

		expect(thrown).toBeInstanceOf(DatabaseUnavailableError);

		expect(thrown).toMatchObject({
			code: 'DATABASE_UNAVAILABLE',
			status: 503,
			message: 'Database "main" is unavailable: database is locked',
			extensions: { database: 'main', reason: 'database is locked' },
			cause: error,
		});
	});

	test('Reads without a location for a driver built by hand', async () => {
		const driver = new DatabaseDriverSqlite({ file: MEMORY_FILE, logger: sample.logger as never });

		sample.db.run.mockImplementation(() => {
			throw new Error('database is locked');
		});

		await expect(driver.ping()).rejects.toThrow('The database is unavailable: database is locked');
	});
});

describe('#migrate', () => {
	test('Runs the better-sqlite3 migrator over the folder', async () => {
		const driver = new DatabaseDriverSqlite({ file: MEMORY_FILE, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder, migrationsTable: undefined });

		// 1. The Drizzle database goes in as is, the options without their undefined keys
		expect(migrate).toHaveBeenCalledExactlyOnceWith(sample.db, { migrationsFolder: sample.folder });
	});

	test('Refuses a missing folder before touching the database', async () => {
		const driver = new DatabaseDriverSqlite({ file: MEMORY_FILE, logger: sample.logger as never });

		await expect(driver.migrate({ migrationsFolder: '' })).rejects.toThrowErrorMatchingInlineSnapshot(
			`[Error: DatabaseDriver.migrate needs a "migrationsFolder"]`,
		);

		expect(migrate).not.toHaveBeenCalled();
	});
});

describe('#close', () => {
	test('Closes the handle', async () => {
		const driver = new DatabaseDriverSqlite({ file: MEMORY_FILE, logger: sample.logger as never });

		await driver.close();

		expect(driver['database'].close).toHaveBeenCalledOnce();
	});
});
