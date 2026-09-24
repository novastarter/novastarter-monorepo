/**
 * Tests of `database-driver-neon/lib/driver`.
 */
import { Pool } from '@neondatabase/serverless';
import { randDirectoryPath, randDomainName, randPassword, randUserName, randWord } from '@ngneat/falso';
import { DatabaseUnavailableError } from '@novastarter/database';
import { useLogger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverNeon } from './driver.js';

// A factory rather than an automock: `neonConfig` is a class of static accessors, and only `Pool` is needed
vi.mock('@neondatabase/serverless', () => ({
	Pool: vi.fn(function () {
		return { on: vi.fn(), end: vi.fn(), connect: vi.fn() };
	}),
}));

vi.mock('@novastarter/logger', () => ({ useLogger: vi.fn() }));
vi.mock('drizzle-orm/neon-serverless', () => ({ drizzle: vi.fn() }));
vi.mock('drizzle-orm/neon-serverless/migrator', () => ({ migrate: vi.fn() }));

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	url: string;
	folder: string;
	logger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; child: ReturnType<typeof vi.fn> };
	processLogger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	db: { execute: ReturnType<typeof vi.fn> };
};

/**
 * The pool the mocked constructor answered with, for the driver built last.
 */
const lastPool = () =>
	vi.mocked(Pool).mock.results.at(-1)!.value as {
		on: ReturnType<typeof vi.fn>;
		end: ReturnType<typeof vi.fn>;
	};

beforeEach(() => {
	// Fresh values per test; the URL has the shape of a Neon console string
	sample = {
		url: `postgresql://${randUserName()}:${randPassword()}@ep-${randWord()}.${randDomainName()}/neondb?sslmode=require`,
		folder: randDirectoryPath(),
		logger: { error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
		processLogger: { error: vi.fn(), debug: vi.fn() },
		db: { execute: vi.fn() },
	};

	// `drizzle` answers a bare object: only `execute` is called, and the migrator is mocked whole
	vi.mocked(drizzle).mockReturnValue(sample.db as never);
	vi.mocked(useLogger).mockReturnValue(sample.processLogger as never);
});

afterEach(() => {
	// Clear the call history, so a pool built in one test cannot be read by the next; the implementations stay,
	// since the `Pool` factory above is what every test constructs its pool with
	vi.clearAllMocks();
});

describe('#constructor', () => {
	test('Throws when the connection is missing', () => {
		// Without one the pool would read node-postgres's `PG*` variables and connect somewhere never configured
		expect(() => new DatabaseDriverNeon({ connection: '' })).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The neon database driver needs a "connection".]`,
		);
	});

	test('Opens a pool of its own from a connection string', () => {
		const driver = new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never });

		// The pool is the driver's, so the driver closes it
		expect(Pool).toHaveBeenCalledExactlyOnceWith({ connectionString: sample.url });
		expect(driver['pool']).toBe(lastPool());
		expect(driver['ownsPool']).toBe(true);
	});

	test('Opens a pool of its own from pool options', () => {
		const options = { host: randDomainName(), database: randWord(), max: 4 };

		new DatabaseDriverNeon({ connection: options, logger: sample.logger as never });

		expect(Pool).toHaveBeenCalledExactlyOnceWith(options);
	});

	test('Uses a given pool as is and leaves it to the caller', () => {
		// A pool built before the driver: the driver must neither open another nor take this one over
		const pool = new Pool();

		const driver = new DatabaseDriverNeon({ connection: pool, logger: sample.logger as never });

		expect(Pool).toHaveBeenCalledOnce();
		expect(driver['pool']).toBe(pool);
		expect(driver['ownsPool']).toBe(false);
		expect(pool.on).not.toHaveBeenCalled();
	});

	test('Reports the errors of its own pool to the logger instead of crashing the process', () => {
		new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never });

		// The listener is on `error`, so an idle client's failure is no longer an unhandled event
		const pool = lastPool();

		expect(pool.on).toHaveBeenCalledExactlyOnceWith('error', expect.any(Function));

		// The error goes first, as pino expects
		const error = new Error('connection terminated');
		const listener = pool.on.mock.calls[0]![1] as (error: Error) => void;

		listener(error);

		expect(sample.logger.error).toHaveBeenCalledExactlyOnceWith(error, 'Neon pool error');
	});

	test('Falls back to the process logger', () => {
		new DatabaseDriverNeon({ connection: sample.url });

		const listener = lastPool().on.mock.calls[0]![1] as (error: Error) => void;
		const error = new Error('connection terminated');

		listener(error);

		expect(sample.processLogger.error).toHaveBeenCalledExactlyOnceWith(error, 'Neon pool error');
	});

	test('Builds the Drizzle database over the pool with the schema and casing', () => {
		const schema = { users: {} };

		const driver = new DatabaseDriverNeon({
			connection: sample.url,
			schema,
			casing: 'snake_case',
			logger: sample.logger as never,
		});

		expect(drizzle).toHaveBeenCalledExactlyOnceWith(driver['pool'], { schema, casing: 'snake_case' });
		expect(driver.db).toBe(sample.db);
	});

	test('Hands Drizzle a query logger only when asked for', () => {
		new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never });

		// Off by default: no logger key, so Drizzle makes no logger call per query
		expect(vi.mocked(drizzle).mock.calls[0]![1]).toStrictEqual({});

		new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never, queryLogging: true });

		const options = vi.mocked(drizzle).mock.calls[1]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(sample.logger.debug).toHaveBeenCalledExactlyOnceWith({ query: 'select 1', paramCount: 0 }, 'Database query');
	});
});

describe('#capabilities', () => {
	test('Declares whether transactions work', () => {
		// Sessions, so `db.transaction()` works; the flag is what an app reads instead of the driver name
		const driver = new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never });

		expect(driver.capabilities).toStrictEqual({ transactions: true });
	});
});

describe('#label', () => {
	test('Binds the label to the logger, so the query log names the location', () => {
		// A labelled driver logs through a child carrying `database`; the query logger inherits it
		const child = { error: vi.fn(), debug: vi.fn() };
		const logger = { ...sample.logger, child: vi.fn().mockReturnValue(child) };

		new DatabaseDriverNeon({ connection: sample.url, label: 'main', queryLogging: true, logger: logger as never });

		expect(logger.child).toHaveBeenCalledExactlyOnceWith({ database: 'main' });

		const options = vi.mocked(drizzle).mock.calls[0]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(child.debug).toHaveBeenCalledExactlyOnceWith({ query: 'select 1', paramCount: 0 }, 'Database query');
		expect(sample.logger.debug).not.toHaveBeenCalled();
	});

	test('Leaves the logger as it is without a label', () => {
		const logger = { ...sample.logger, child: vi.fn() };

		new DatabaseDriverNeon({ connection: sample.url, logger: logger as never });

		expect(logger.child).not.toHaveBeenCalled();
	});
});

describe('#ping', () => {
	test('Runs select 1 through Drizzle', async () => {
		const driver = new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never });

		await driver.ping();

		// Through `db.execute`, so the same path the application's queries take is what gets proven
		expect(sample.db.execute).toHaveBeenCalledExactlyOnceWith(sql`select 1`);
	});

	test('Wraps what the query raised in DatabaseUnavailableError, naming the location', async () => {
		const driver = new DatabaseDriverNeon({ connection: sample.url, label: 'main', logger: sample.logger as never });
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
		const driver = new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never });

		sample.db.execute.mockRejectedValue(new Error('connection refused'));

		await expect(driver.ping()).rejects.toThrow('The database is unavailable: connection refused');
	});
});

describe('#migrate', () => {
	test('Runs the Neon migrator over the folder', async () => {
		const driver = new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder, migrationsTable: undefined });

		expect(migrate).toHaveBeenCalledExactlyOnceWith(sample.db, { migrationsFolder: sample.folder });
	});

	test('Forwards the journal table and schema', async () => {
		const driver = new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder, migrationsTable: 'migrations', migrationsSchema: 'app' });

		expect(migrate).toHaveBeenCalledExactlyOnceWith(sample.db, {
			migrationsFolder: sample.folder,
			migrationsTable: 'migrations',
			migrationsSchema: 'app',
		});
	});

	test('Refuses a missing folder before touching the database', async () => {
		const driver = new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never });

		await expect(driver.migrate({ migrationsFolder: '' })).rejects.toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. DatabaseDriver.migrate needs a "migrationsFolder".]`,
		);

		expect(migrate).not.toHaveBeenCalled();
	});
});

describe('#close', () => {
	test('Ends a pool of its own', async () => {
		const driver = new DatabaseDriverNeon({ connection: sample.url, logger: sample.logger as never });

		await driver.close();

		expect(lastPool().end).toHaveBeenCalledOnce();
	});

	test('Leaves a given pool open for its owner', async () => {
		// The caller built the pool and may share it; ending it here would pull it from under them
		const pool = new Pool();
		const driver = new DatabaseDriverNeon({ connection: pool, logger: sample.logger as never });

		await driver.close();

		expect(pool.end).not.toHaveBeenCalled();
	});
});
