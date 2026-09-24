/**
 * Tests of `database-driver-mysql/lib/driver`.
 */
import { randDirectoryPath, randDomainName, randPassword, randUserName, randWord } from '@ngneat/falso';
import { DatabaseUnavailableError } from '@novastarter/database';
import { useLogger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createPool, type Pool } from 'mysql2/promise';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverMysql } from './driver.js';

vi.mock('mysql2/promise', () => ({ createPool: vi.fn() }));
vi.mock('@novastarter/logger', () => ({ useLogger: vi.fn() }));
vi.mock('drizzle-orm/mysql2', () => ({ drizzle: vi.fn() }));
vi.mock('drizzle-orm/mysql2/migrator', () => ({ migrate: vi.fn() }));

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	uri: string;
	folder: string;
	logger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; child: ReturnType<typeof vi.fn> };
	processLogger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	pool: { getConnection: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
	db: { execute: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
	// Fresh values per test; the URI is well-formed so the test reads like a real configuration
	sample = {
		uri: `mysql://${randUserName()}:${randPassword()}@${randDomainName()}:3306/${randWord()}`,
		folder: randDirectoryPath(),
		logger: { error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
		processLogger: { error: vi.fn(), debug: vi.fn() },
		pool: { getConnection: vi.fn(), end: vi.fn() },
		db: { execute: vi.fn() },
	};

	// `createPool` answers a bare pool and `drizzle` a bare database: only the members the driver calls exist
	vi.mocked(createPool).mockReturnValue(sample.pool as unknown as Pool);
	vi.mocked(drizzle).mockReturnValue(sample.db as never);
	vi.mocked(useLogger).mockReturnValue(sample.processLogger as never);
});

afterEach(() => {
	// Reset call history and implementations, so a `mockReturnValue` set in one test cannot leak into the next
	vi.resetAllMocks();
});

describe('#constructor', () => {
	test('Throws when the connection is missing', () => {
		// Without one mysql2 would open a pool on `localhost:3306` as `root`, a server never configured
		expect(() => new DatabaseDriverMysql({ connection: '' })).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The mysql database driver needs a "connection".]`,
		);
	});

	test('Opens a pool of its own from a connection URI', () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		// The pool is the driver's, so the driver closes it
		expect(createPool).toHaveBeenCalledExactlyOnceWith({ uri: sample.uri });
		expect(driver['pool']).toBe(sample.pool);
		expect(driver['ownsPool']).toBe(true);
	});

	test('Opens a pool of its own from pool options', () => {
		const options = { host: randDomainName(), database: randWord(), connectionLimit: 4 };

		new DatabaseDriverMysql({ connection: options, logger: sample.logger as never });

		expect(createPool).toHaveBeenCalledExactlyOnceWith(options);
	});

	test('Uses a given pool as is and leaves it to the caller', () => {
		// A pool built before the driver: the driver must neither open another nor take this one over
		const pool = { getConnection: vi.fn(), end: vi.fn() } as unknown as Pool;

		const driver = new DatabaseDriverMysql({ connection: pool, logger: sample.logger as never });

		expect(createPool).not.toHaveBeenCalled();
		expect(driver['pool']).toBe(pool);
		expect(driver['ownsPool']).toBe(false);
	});

	test('Builds the Drizzle database over the pool with the schema, casing and the default mode', () => {
		const schema = { users: {} };

		const driver = new DatabaseDriverMysql({
			connection: sample.uri,
			schema,
			casing: 'snake_case',
			logger: sample.logger as never,
		});

		// Drizzle always gets a `mode`: it refuses a schema without one
		expect(drizzle).toHaveBeenCalledExactlyOnceWith(sample.pool, { schema, casing: 'snake_case', mode: 'default' });
		expect(driver.db).toBe(sample.db);
	});

	test('Forwards the planetscale mode', () => {
		new DatabaseDriverMysql({ connection: sample.uri, mode: 'planetscale', logger: sample.logger as never });

		expect(drizzle).toHaveBeenCalledExactlyOnceWith(sample.pool, { mode: 'planetscale' });
	});

	test('Hands Drizzle a query logger on the process logger only when asked for', () => {
		new DatabaseDriverMysql({ connection: sample.uri });

		// Off by default: no logger key, so Drizzle makes no logger call per query
		expect(vi.mocked(drizzle).mock.calls[0]![1]).toStrictEqual({ mode: 'default' });

		new DatabaseDriverMysql({ connection: sample.uri, queryLogging: true });

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
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		expect(driver.capabilities).toStrictEqual({ transactions: true });
	});
});

describe('#label', () => {
	test('Binds the label to the logger, so the query log names the location', () => {
		// A labelled driver logs through a child carrying `database`; the query logger inherits it
		const child = { error: vi.fn(), debug: vi.fn() };
		const logger = { ...sample.logger, child: vi.fn().mockReturnValue(child) };

		new DatabaseDriverMysql({ connection: sample.uri, label: 'main', queryLogging: true, logger: logger as never });

		expect(logger.child).toHaveBeenCalledExactlyOnceWith({ database: 'main' });

		const options = vi.mocked(drizzle).mock.calls[0]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(child.debug).toHaveBeenCalledExactlyOnceWith({ query: 'select 1', paramCount: 0 }, 'Database query');
		expect(sample.logger.debug).not.toHaveBeenCalled();
	});

	test('Leaves the logger as it is without a label', () => {
		const logger = { ...sample.logger, child: vi.fn() };

		new DatabaseDriverMysql({ connection: sample.uri, logger: logger as never });

		expect(logger.child).not.toHaveBeenCalled();
	});
});

describe('#ping', () => {
	test('Runs select 1 through Drizzle', async () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		await driver.ping();

		// Through `db.execute`, so the same path the application's queries take is what gets proven
		expect(sample.db.execute).toHaveBeenCalledExactlyOnceWith(sql`select 1`);
	});

	test('Wraps what the query raised in DatabaseUnavailableError, naming the location', async () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, label: 'main', logger: sample.logger as never });
		const error = new Error('connection refused');

		sample.db.execute.mockRejectedValue(error);

		// One error for every backend: recognisable, 503, the location in the message, the backend's error as cause
		const thrown: unknown = await driver.ping().catch((caught: unknown) => caught);

		expect(thrown).toBeInstanceOf(DatabaseUnavailableError);

		expect(thrown).toMatchObject({
			code: 'DATABASE_UNAVAILABLE',
			status: 503,
			message: 'Database "main" is unavailable: connection refused',
			extensions: { database: 'main', reason: 'connection refused' },
			cause: error,
		});
	});

	test('Reads without a location for a driver built by hand', async () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		sample.db.execute.mockRejectedValue(new Error('connection refused'));

		await expect(driver.ping()).rejects.toThrow('The database is unavailable: connection refused');
	});
});

describe('#migrate', () => {
	test('Runs the mysql2 migrator over the folder', async () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder, migrationsTable: undefined });

		expect(migrate).toHaveBeenCalledExactlyOnceWith(sample.db, { migrationsFolder: sample.folder });
	});

	test('Forwards the journal table', async () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder, migrationsTable: 'migrations' });

		expect(migrate).toHaveBeenCalledExactlyOnceWith(sample.db, {
			migrationsFolder: sample.folder,
			migrationsTable: 'migrations',
		});
	});

	test('Refuses a missing folder before touching the database', async () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		await expect(driver.migrate({ migrationsFolder: '' })).rejects.toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. DatabaseDriver.migrate needs a "migrationsFolder".]`,
		);

		expect(migrate).not.toHaveBeenCalled();
	});
});

describe('#close', () => {
	test('Ends a pool of its own', async () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		await driver.close();

		expect(sample.pool.end).toHaveBeenCalledOnce();
	});

	test('Leaves a given pool open for its owner', async () => {
		// The caller built the pool and may share it; ending it here would pull it from under them
		const pool = { getConnection: vi.fn(), end: vi.fn() } as unknown as Pool;
		const driver = new DatabaseDriverMysql({ connection: pool, logger: sample.logger as never });

		await driver.close();

		expect(pool.end).not.toHaveBeenCalled();
	});
});
