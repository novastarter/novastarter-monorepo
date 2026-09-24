/**
 * Tests of `database-driver-turso/lib/driver`.
 */
import { mkdirSync } from 'node:fs';
import { type Client, createClient } from '@libsql/client';
import { randDirectoryPath, randDomainName, randFileName, randPassword } from '@ngneat/falso';
import { DatabaseUnavailableError } from '@novastarter/database';
import { useLogger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverTurso, MEMORY_URL } from './driver.js';

// A factory rather than an automock of `@libsql/client`: automocking would load the native binding first
vi.mock('@libsql/client', () => ({ createClient: vi.fn() }));
vi.mock('node:fs');
vi.mock('@novastarter/logger', () => ({ useLogger: vi.fn() }));
vi.mock('drizzle-orm/libsql', () => ({ drizzle: vi.fn() }));
vi.mock('drizzle-orm/libsql/migrator', () => ({ migrate: vi.fn() }));

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	directory: string;
	file: string;
	remote: string;
	folder: string;
	logger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; child: ReturnType<typeof vi.fn> };
	processLogger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	client: { execute: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
	db: { run: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
	// Fresh values per test; the file sits in a directory, so the directory creation has something to do
	const directory = randDirectoryPath();

	sample = {
		directory,
		file: `${directory}/${randFileName()}.db`,
		remote: `libsql://${randDomainName()}`,
		folder: randDirectoryPath(),
		logger: { error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
		processLogger: { error: vi.fn(), debug: vi.fn() },
		client: { execute: vi.fn(), close: vi.fn() },
		db: { run: vi.fn() },
	};

	// `createClient` answers a bare client and `drizzle` a bare database: only the members the driver calls exist
	vi.mocked(createClient).mockReturnValue(sample.client as unknown as Client);
	vi.mocked(drizzle).mockReturnValue(sample.db as never);
	vi.mocked(useLogger).mockReturnValue(sample.processLogger as never);
});

afterEach(() => {
	// Reset call history and implementations, so a `mockReturnValue` set in one test cannot leak into the next
	vi.resetAllMocks();
});

describe('#constructor', () => {
	test('Throws when the connection is missing, or is a config without a url', () => {
		// libsql would report an invalid URL of `undefined`, far from the configuration at fault
		expect(() => new DatabaseDriverTurso({ connection: '' })).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The turso database driver needs a "connection".]`,
		);

		expect(() => new DatabaseDriverTurso({ connection: { url: '' } })).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The turso database driver needs a "connection".]`,
		);

		expect(createClient).not.toHaveBeenCalled();
	});

	test('Opens a client of its own from a URL, creating the directory of a local file', () => {
		const driver = new DatabaseDriverTurso({ connection: `file:${sample.file}`, logger: sample.logger as never });

		// SQLite creates no directories, so the directory comes first, recursively
		expect(mkdirSync).toHaveBeenCalledExactlyOnceWith(sample.directory, { recursive: true });
		expect(createClient).toHaveBeenCalledExactlyOnceWith({ url: `file:${sample.file}` });
		expect(driver['client']).toBe(sample.client);
		expect(driver['ownsClient']).toBe(true);
	});

	test('Passes a config through as it is, creating the directory of its local file', () => {
		const config = { url: `file:${sample.file}`, syncUrl: sample.remote, authToken: randPassword(), syncInterval: 60 };

		new DatabaseDriverTurso({ connection: config, logger: sample.logger as never });

		expect(mkdirSync).toHaveBeenCalledExactlyOnceWith(sample.directory, { recursive: true });
		expect(createClient).toHaveBeenCalledExactlyOnceWith(config);
	});

	test('Creates no directory for a database in memory or a remote one', () => {
		new DatabaseDriverTurso({ connection: MEMORY_URL, logger: sample.logger as never });
		new DatabaseDriverTurso({ connection: { url: sample.remote, authToken: randPassword() } });

		expect(mkdirSync).not.toHaveBeenCalled();
		expect(createClient).toHaveBeenCalledTimes(2);
	});

	test('Uses a given client as is and leaves it to the caller', () => {
		// A client built before the driver: the driver must neither open another nor take this one over
		const client = { execute: vi.fn(), close: vi.fn() } as unknown as Client;

		const driver = new DatabaseDriverTurso({ connection: client, logger: sample.logger as never });

		expect(createClient).not.toHaveBeenCalled();
		expect(mkdirSync).not.toHaveBeenCalled();
		expect(driver['client']).toBe(client);
		expect(driver['ownsClient']).toBe(false);
		expect(drizzle).toHaveBeenCalledExactlyOnceWith(client, {});
	});

	test('Builds the Drizzle database over the client with the schema and casing', () => {
		const schema = { notes: {} };

		const driver = new DatabaseDriverTurso({
			connection: MEMORY_URL,
			schema,
			casing: 'snake_case',
			logger: sample.logger as never,
		});

		expect(drizzle).toHaveBeenCalledExactlyOnceWith(sample.client, { schema, casing: 'snake_case' });
		expect(driver.db).toBe(sample.db);
	});

	test('Hands Drizzle a query logger on the process logger only when asked for', () => {
		new DatabaseDriverTurso({ connection: MEMORY_URL });

		// Off by default: no logger key, so Drizzle makes no logger call per query
		expect(vi.mocked(drizzle).mock.calls[0]![1]).toStrictEqual({});

		new DatabaseDriverTurso({ connection: MEMORY_URL, queryLogging: true });

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
		// Sessions, so `db.transaction()` works; the flag is what an app reads instead of the driver name
		const driver = new DatabaseDriverTurso({ connection: MEMORY_URL, logger: sample.logger as never });

		expect(driver.capabilities).toStrictEqual({ transactions: true });
	});
});

describe('#label', () => {
	test('Binds the label to the logger, so the query log names the location', () => {
		// A labelled driver logs through a child carrying `database`; the query logger inherits it
		const child = { error: vi.fn(), debug: vi.fn() };
		const logger = { ...sample.logger, child: vi.fn().mockReturnValue(child) };

		new DatabaseDriverTurso({ connection: MEMORY_URL, label: 'main', queryLogging: true, logger: logger as never });

		expect(logger.child).toHaveBeenCalledExactlyOnceWith({ database: 'main' });

		const options = vi.mocked(drizzle).mock.calls[0]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(child.debug).toHaveBeenCalledExactlyOnceWith({ query: 'select 1', paramCount: 0 }, 'Database query');
		expect(sample.logger.debug).not.toHaveBeenCalled();
	});

	test('Leaves the logger as it is without a label', () => {
		const logger = { ...sample.logger, child: vi.fn() };

		new DatabaseDriverTurso({ connection: MEMORY_URL, logger: logger as never });

		expect(logger.child).not.toHaveBeenCalled();
	});
});

describe('#ping', () => {
	test('Runs select 1 through Drizzle', async () => {
		const driver = new DatabaseDriverTurso({ connection: MEMORY_URL, logger: sample.logger as never });

		await driver.ping();

		// Through `db.run`, so the same path the application's statements take is what gets proven
		expect(sample.db.run).toHaveBeenCalledExactlyOnceWith(sql`select 1`);
	});

	test('Wraps what the query raised in DatabaseUnavailableError, naming the location', async () => {
		const driver = new DatabaseDriverTurso({ connection: MEMORY_URL, label: 'main', logger: sample.logger as never });
		const error = new Error('SQLITE_BUSY');

		sample.db.run.mockRejectedValue(error);

		// One error for every backend: recognisable, 503, the location in the message, the backend's error as cause
		const thrown: unknown = await driver.ping().catch((caught: unknown) => caught);

		expect(thrown).toBeInstanceOf(DatabaseUnavailableError);

		expect(thrown).toMatchObject({
			code: 'DATABASE_UNAVAILABLE',
			status: 503,
			message: 'Database "main" is unavailable: SQLITE_BUSY',
			extensions: { database: 'main', reason: 'SQLITE_BUSY' },
			cause: error,
		});
	});

	test('Reads without a location for a driver built by hand', async () => {
		const driver = new DatabaseDriverTurso({ connection: MEMORY_URL, logger: sample.logger as never });

		sample.db.run.mockRejectedValue(new Error('SQLITE_BUSY'));

		await expect(driver.ping()).rejects.toThrow('The database is unavailable: SQLITE_BUSY');
	});
});

describe('#migrate', () => {
	test('Runs the libsql migrator over the folder', async () => {
		const driver = new DatabaseDriverTurso({ connection: MEMORY_URL, logger: sample.logger as never });

		await driver.migrate({
			migrationsFolder: sample.folder,
			migrationsTable: 'migrations',
			migrationsSchema: undefined,
		});

		expect(migrate).toHaveBeenCalledExactlyOnceWith(sample.db, {
			migrationsFolder: sample.folder,
			migrationsTable: 'migrations',
		});
	});

	test('Refuses a missing folder before touching the database', async () => {
		const driver = new DatabaseDriverTurso({ connection: MEMORY_URL, logger: sample.logger as never });

		await expect(driver.migrate({ migrationsFolder: '' })).rejects.toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. DatabaseDriver.migrate needs a "migrationsFolder".]`,
		);

		expect(migrate).not.toHaveBeenCalled();
	});
});

describe('#close', () => {
	test('Closes a client of its own', async () => {
		const driver = new DatabaseDriverTurso({ connection: MEMORY_URL, logger: sample.logger as never });

		await driver.close();

		expect(sample.client.close).toHaveBeenCalledOnce();
	});

	test('Leaves a given client open for its owner', async () => {
		// The caller built the client and may share it; closing it here would pull it from under them
		const client = { execute: vi.fn(), close: vi.fn() } as unknown as Client;
		const driver = new DatabaseDriverTurso({ connection: client, logger: sample.logger as never });

		await driver.close();

		expect(client.close).not.toHaveBeenCalled();
	});
});
