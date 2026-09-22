/**
 * Tests of `database-driver-mysql/lib/driver`.
 */
import { randDirectoryPath, randDomainName, randPassword, randUserName, randWord } from '@ngneat/falso';
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
	logger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	processLogger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	pool: { getConnection: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
	db: { execute: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
	// 1. Fresh values per test; the URI is well-formed so the test reads like a real configuration
	sample = {
		uri: `mysql://${randUserName()}:${randPassword()}@${randDomainName()}:3306/${randWord()}`,
		folder: randDirectoryPath(),
		logger: { error: vi.fn(), debug: vi.fn() },
		processLogger: { error: vi.fn(), debug: vi.fn() },
		pool: { getConnection: vi.fn(), end: vi.fn() },
		db: { execute: vi.fn() },
	};

	// 2. `createPool` answers a bare pool and `drizzle` a bare database: only the members the driver calls exist
	vi.mocked(createPool).mockReturnValue(sample.pool as unknown as Pool);
	vi.mocked(drizzle).mockReturnValue(sample.db as never);
	vi.mocked(useLogger).mockReturnValue(sample.processLogger as never);
});

afterEach(() => {
	// 1. Reset call history and implementations, so a `mockReturnValue` set in one test cannot leak into the next
	vi.resetAllMocks();
});

describe('#constructor', () => {
	test('Throws when the connection is missing', () => {
		// 1. Without one mysql2 would open a pool on `localhost:3306` as `root`, a server never configured
		expect(() => new DatabaseDriverMysql({ connection: '' })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The mysql database driver needs a "connection"]`,
		);
	});

	test('Opens a pool of its own from a connection URI', () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		// 1. The URI becomes the pool's `uri` option; the pool is the driver's, so it is closed by it
		expect(createPool).toHaveBeenCalledExactlyOnceWith({ uri: sample.uri });
		expect(driver['pool']).toBe(sample.pool);
		expect(driver['ownsPool']).toBe(true);
	});

	test('Opens a pool of its own from pool options', () => {
		const options = { host: randDomainName(), database: randWord(), connectionLimit: 4 };

		new DatabaseDriverMysql({ connection: options, logger: sample.logger as never });

		// 1. Options go to mysql2 as they are
		expect(createPool).toHaveBeenCalledExactlyOnceWith(options);
	});

	test('Uses a given pool as is and leaves it to the caller', () => {
		// 1. A pool built before the driver: the driver must neither open another nor take this one over
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

		// 1. Drizzle gets the pool, only the options that carry a value, and always a `mode` — it refuses a schema
		//    without one
		expect(drizzle).toHaveBeenCalledExactlyOnceWith(sample.pool, { schema, casing: 'snake_case', mode: 'default' });
		expect(driver.db).toBe(sample.db);
	});

	test('Forwards the planetscale mode', () => {
		new DatabaseDriverMysql({ connection: sample.uri, mode: 'planetscale', logger: sample.logger as never });

		expect(drizzle).toHaveBeenCalledExactlyOnceWith(sample.pool, { mode: 'planetscale' });
	});

	test('Hands Drizzle a query logger on the process logger only when asked for', () => {
		new DatabaseDriverMysql({ connection: sample.uri });

		// 1. Off by default: no logger key, so Drizzle makes no logger call per query
		expect(vi.mocked(drizzle).mock.calls[0]![1]).toStrictEqual({ mode: 'default' });

		new DatabaseDriverMysql({ connection: sample.uri, queryLogging: true });

		// 2. On, without a logger of its own: the query logger reports to the process logger
		const options = vi.mocked(drizzle).mock.calls[1]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(sample.processLogger.debug).toHaveBeenCalledExactlyOnceWith(
			{ query: 'select 1', params: [] },
			'Database query',
		);
	});
});

describe('#ping', () => {
	test('Runs select 1 through Drizzle', async () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		await driver.ping();

		// 1. Through `db.execute`, so the same path the application's queries take is what gets proven
		expect(sample.db.execute).toHaveBeenCalledExactlyOnceWith(sql`select 1`);
	});

	test('Rethrows what the query raised', async () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });
		const error = new Error('connection refused');

		sample.db.execute.mockRejectedValue(error);

		await expect(driver.ping()).rejects.toBe(error);
	});
});

describe('#migrate', () => {
	test('Runs the mysql2 migrator over the folder', async () => {
		const driver = new DatabaseDriverMysql({ connection: sample.uri, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder, migrationsTable: undefined });

		// 1. The Drizzle database goes in as is, the options without their undefined keys
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
			`[Error: DatabaseDriver.migrate needs a "migrationsFolder"]`,
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
		// 1. The caller built the pool and may share it; ending it here would pull it from under them
		const pool = { getConnection: vi.fn(), end: vi.fn() } as unknown as Pool;
		const driver = new DatabaseDriverMysql({ connection: pool, logger: sample.logger as never });

		await driver.close();

		expect(pool.end).not.toHaveBeenCalled();
	});
});
