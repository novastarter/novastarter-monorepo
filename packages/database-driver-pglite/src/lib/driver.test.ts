/**
 * Tests of `database-driver-pglite/lib/driver`.
 */
import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { randDirectoryPath } from '@ngneat/falso';
import { useLogger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverPglite, dataDirectory, MEMORY_DATA_DIR } from './driver.js';

// A factory rather than an automock: importing the real module is cheap, but its class boots WebAssembly when
// constructed, and only the two members the driver touches are needed
vi.mock('@electric-sql/pglite', () => ({
	PGlite: vi.fn(function () {
		return { waitReady: Promise.resolve(), close: vi.fn() };
	}),
}));

vi.mock('node:fs');
vi.mock('@novastarter/logger', () => ({ useLogger: vi.fn() }));
vi.mock('drizzle-orm/pglite', () => ({ drizzle: vi.fn() }));
vi.mock('drizzle-orm/pglite/migrator', () => ({ migrate: vi.fn() }));

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	directory: string;
	folder: string;
	logger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	processLogger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	db: { execute: ReturnType<typeof vi.fn> };
};

/**
 * The instance the mocked constructor answered with, for the driver built last.
 */
const lastClient = () =>
	vi.mocked(PGlite).mock.results.at(-1)!.value as { waitReady: Promise<void>; close: ReturnType<typeof vi.fn> };

beforeEach(() => {
	// 1. Fresh values per test
	sample = {
		directory: randDirectoryPath(),
		folder: randDirectoryPath(),
		logger: { error: vi.fn(), debug: vi.fn() },
		processLogger: { error: vi.fn(), debug: vi.fn() },
		db: { execute: vi.fn() },
	};

	// 2. `drizzle` answers a bare object: only `execute` is called, and the migrator is mocked whole
	vi.mocked(drizzle).mockReturnValue(sample.db as never);
	vi.mocked(useLogger).mockReturnValue(sample.processLogger as never);
});

afterEach(() => {
	// 1. Clear the call history, so an instance built in one test cannot be read by the next; the implementations
	//    stay, since the `PGlite` factory above is what every test constructs its instance with
	vi.clearAllMocks();
});

describe('dataDirectory', () => {
	test('Answers the path of a bare path or a file:// string, nothing for another scheme', () => {
		expect(dataDirectory('./data/pglite')).toBe('./data/pglite');
		expect(dataDirectory('file:///var/lib/pglite')).toBe('/var/lib/pglite');
		expect(dataDirectory(MEMORY_DATA_DIR)).toBeUndefined();
		expect(dataDirectory('idb://app')).toBeUndefined();
	});
});

describe('#constructor', () => {
	test('Throws when the connection is missing', () => {
		// 1. An empty string would be a database in memory whose writes vanish at exit
		expect(() => new DatabaseDriverPglite({ connection: '' })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The pglite database driver needs a "connection"]`,
		);
	});

	test('Creates the directory with its parents and starts an instance on it', () => {
		const driver = new DatabaseDriverPglite({ connection: sample.directory, logger: sample.logger as never });

		// 1. The directory first, recursively, since PGlite creates the leaf only; then the instance on the path alone
		expect(mkdirSync).toHaveBeenCalledExactlyOnceWith(sample.directory, { recursive: true });
		expect(PGlite).toHaveBeenCalledExactlyOnceWith(sample.directory);
		expect(driver['client']).toBe(lastClient());
		expect(driver['ownsClient']).toBe(true);
	});

	test('Strips a file:// prefix before creating the directory', () => {
		new DatabaseDriverPglite({ connection: `file://${sample.directory}`, logger: sample.logger as never });

		// 1. The prefix is PGlite's to read; the filesystem wants the bare path
		expect(mkdirSync).toHaveBeenCalledExactlyOnceWith(sample.directory, { recursive: true });
		expect(PGlite).toHaveBeenCalledExactlyOnceWith(`file://${sample.directory}`);
	});

	test('Creates no directory for a database in memory', () => {
		new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR, logger: sample.logger as never });

		expect(mkdirSync).not.toHaveBeenCalled();
		expect(PGlite).toHaveBeenCalledExactlyOnceWith(MEMORY_DATA_DIR);
	});

	test('Passes the PGlite options through', () => {
		const options = { debug: 1 as const, initialMemory: 64 * 1024 * 1024 };

		new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR, options, logger: sample.logger as never });

		expect(PGlite).toHaveBeenCalledExactlyOnceWith(MEMORY_DATA_DIR, options);
	});

	test('Uses a given instance as is and leaves it to the caller', () => {
		// 1. An instance built before the driver: the driver must neither start another nor take this one over
		const client = new PGlite();

		const driver = new DatabaseDriverPglite({ connection: client, logger: sample.logger as never });

		expect(PGlite).toHaveBeenCalledOnce();
		expect(mkdirSync).not.toHaveBeenCalled();
		expect(driver['client']).toBe(client);
		expect(driver['ownsClient']).toBe(false);
		expect(drizzle).toHaveBeenCalledExactlyOnceWith(client, {});
	});

	test('Reports a failed boot to the logger instead of crashing the process', async () => {
		// 1. The boot promise rejects with nobody awaiting it — the case that would be an unhandled rejection
		const error = new Error('wasm failed to load');

		vi.mocked(PGlite).mockImplementationOnce(function () {
			return { waitReady: Promise.reject(error), close: vi.fn() } as never;
		});

		new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR });

		// 2. The rejection lands on the process logger, since no logger was given
		await vi.waitFor(() => {
			expect(sample.processLogger.error).toHaveBeenCalledExactlyOnceWith(error, 'PGlite failed to start');
		});
	});

	test('Builds the Drizzle database over the instance with the schema and casing', () => {
		const schema = { notes: {} };

		const driver = new DatabaseDriverPglite({
			connection: MEMORY_DATA_DIR,
			schema,
			casing: 'snake_case',
			logger: sample.logger as never,
		});

		// 1. Drizzle gets the instance and only the options that carry a value
		expect(drizzle).toHaveBeenCalledExactlyOnceWith(driver['client'], { schema, casing: 'snake_case' });
		expect(driver.db).toBe(sample.db);
	});

	test('Hands Drizzle a query logger only when asked for', () => {
		new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR, logger: sample.logger as never });

		// 1. Off by default: no logger key, so Drizzle makes no logger call per query
		expect(vi.mocked(drizzle).mock.calls[0]![1]).toStrictEqual({});

		new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR, logger: sample.logger as never, queryLogging: true });

		// 2. On: the query logger reports to the driver's logger
		const options = vi.mocked(drizzle).mock.calls[1]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(sample.logger.debug).toHaveBeenCalledExactlyOnceWith({ query: 'select 1', params: [] }, 'Database query');
	});
});

describe('#ping', () => {
	test('Runs select 1 through Drizzle', async () => {
		const driver = new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR, logger: sample.logger as never });

		await driver.ping();

		// 1. Through `db.execute`, so the same path the application's queries take is what gets proven
		expect(sample.db.execute).toHaveBeenCalledExactlyOnceWith(sql`select 1`);
	});

	test('Rethrows what the query raised', async () => {
		const driver = new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR, logger: sample.logger as never });
		const error = new Error('PGlite is closed');

		sample.db.execute.mockRejectedValue(error);

		await expect(driver.ping()).rejects.toBe(error);
	});
});

describe('#migrate', () => {
	test('Runs the PGlite migrator over the folder', async () => {
		const driver = new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder, migrationsSchema: 'app', migrationsTable: undefined });

		// 1. The Drizzle database goes in as is, the options without their undefined keys
		expect(migrate).toHaveBeenCalledExactlyOnceWith(sample.db, {
			migrationsFolder: sample.folder,
			migrationsSchema: 'app',
		});
	});

	test('Refuses a missing folder before touching the database', async () => {
		const driver = new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR, logger: sample.logger as never });

		await expect(driver.migrate({ migrationsFolder: '' })).rejects.toThrowErrorMatchingInlineSnapshot(
			`[Error: DatabaseDriver.migrate needs a "migrationsFolder"]`,
		);

		expect(migrate).not.toHaveBeenCalled();
	});
});

describe('#close', () => {
	test('Closes an instance of its own, once', async () => {
		const driver = new DatabaseDriverPglite({ connection: MEMORY_DATA_DIR, logger: sample.logger as never });

		await driver.close();

		expect(lastClient().close).toHaveBeenCalledOnce();

		// 1. PGlite refuses a second close; an instance reporting itself closed is left alone
		(lastClient() as { closed?: boolean }).closed = true;

		await driver.close();

		expect(lastClient().close).toHaveBeenCalledOnce();
	});

	test('Leaves a given instance open for its owner', async () => {
		// 1. The caller built the instance and may share it; closing it here would pull it from under them
		const client = new PGlite();
		const driver = new DatabaseDriverPglite({ connection: client, logger: sample.logger as never });

		await driver.close();

		expect(client.close).not.toHaveBeenCalled();
	});
});
