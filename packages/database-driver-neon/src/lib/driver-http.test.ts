/**
 * Tests of `database-driver-neon/lib/driver-http`.
 */
import { neon } from '@neondatabase/serverless';
import { randDirectoryPath, randDomainName, randPassword, randUserName, randWord } from '@ngneat/falso';
import { DatabaseUnavailableError } from '@novastarter/database';
import { useLogger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/neon-http';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverNeonHttp, type NeonHttpClient } from './driver-http.js';

// A factory rather than an automock: `neonConfig` is a class of static accessors, and only `neon` is needed
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn() }));
vi.mock('@novastarter/logger', () => ({ useLogger: vi.fn() }));
vi.mock('drizzle-orm/neon-http', () => ({ drizzle: vi.fn() }));
vi.mock('drizzle-orm/migrator', () => ({ readMigrationFiles: vi.fn() }));

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	url: string;
	folder: string;
	logger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; child: ReturnType<typeof vi.fn> };
	processLogger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	client: NeonHttpClient;
	db: { execute: ReturnType<typeof vi.fn>; $client: NeonHttpClient };
};

/**
 * Stand-in for the query function's `query()` and `transaction()`, recording what the migrator sends.
 *
 * `query()` answers a promise carrying the statement and its parameters, so a test can read what went into a
 * transaction; the journal read resolves to `rows`.
 *
 * @param rows - What the `select` on the journal answers.
 * @returns The two mocks, to attach to the client and assert on.
 */
const mockClient = (
	rows: { created_at: string }[] = [],
): { query: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> } => {
	// 1. Every statement is a thenable tagged with its text, like a lazy `NeonQueryPromise`
	const query = vi.fn((text: string, params?: unknown[]) =>
		Object.assign(Promise.resolve(text.startsWith('select') ? rows : []), { text, params }),
	);

	// 2. The transaction resolves by default; a test makes one reject to play a failing migration
	const transaction = vi.fn().mockResolvedValue([]);

	// 3. Attach both to the shared client, where the driver reaches them through `db.$client`
	Object.assign(sample.client, { query, transaction });

	return { query, transaction };
};

beforeEach(() => {
	// 1. Fresh values per test; the client is a function, as `neon()` answers with one
	sample = {
		url: `postgresql://${randUserName()}:${randPassword()}@ep-${randWord()}.${randDomainName()}/neondb?sslmode=require`,
		folder: randDirectoryPath(),
		logger: { error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
		processLogger: { error: vi.fn(), debug: vi.fn() },
		client: vi.fn() as unknown as NeonHttpClient,
		db: { execute: vi.fn(), $client: undefined as unknown as NeonHttpClient },
	};

	sample.db.$client = sample.client;

	// 2. `neon` answers the bare function and `drizzle` a bare object: only `execute` is called
	vi.mocked(neon).mockReturnValue(sample.client as never);
	vi.mocked(drizzle).mockReturnValue(sample.db as never);
	vi.mocked(useLogger).mockReturnValue(sample.processLogger as never);
});

afterEach(() => {
	// 1. Reset call history and implementations, so a `mockReturnValue` set in one test cannot leak into the next
	vi.resetAllMocks();
});

describe('#constructor', () => {
	test('Throws when the connection is missing', () => {
		expect(() => new DatabaseDriverNeonHttp({ connection: '' })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The neon-http database driver needs a "connection"]`,
		);
	});

	test('Builds a query function from a connection string', () => {
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		// 1. `neon()` gets the string alone: an `options: undefined` next to it would be an explicit value
		expect(neon).toHaveBeenCalledExactlyOnceWith(sample.url);
		expect(drizzle).toHaveBeenCalledExactlyOnceWith(sample.client, {});
		expect(driver.db).toBe(sample.db);
	});

	test('Passes the neon options through', () => {
		const options = { authToken: randPassword(), fetchOptions: { cache: 'no-store' as const } };

		new DatabaseDriverNeonHttp({ connection: sample.url, options, logger: sample.logger as never });

		expect(neon).toHaveBeenCalledExactlyOnceWith(sample.url, options);
	});

	test('Uses a given query function as is', () => {
		// 1. A function built before the driver, with whatever options its owner chose: `neon()` is not called
		const client = vi.fn() as unknown as NeonHttpClient;

		new DatabaseDriverNeonHttp({ connection: client, logger: sample.logger as never });

		expect(neon).not.toHaveBeenCalled();
		expect(drizzle).toHaveBeenCalledExactlyOnceWith(client, {});
	});

	test('Builds the Drizzle database with the schema and casing', () => {
		const schema = { users: {} };

		new DatabaseDriverNeonHttp({
			connection: sample.url,
			schema,
			casing: 'snake_case',
			logger: sample.logger as never,
		});

		// 1. Drizzle gets the function and only the options that carry a value
		expect(drizzle).toHaveBeenCalledExactlyOnceWith(sample.client, { schema, casing: 'snake_case' });
	});

	test('Hands Drizzle a query logger on the process logger only when asked for', () => {
		new DatabaseDriverNeonHttp({ connection: sample.url });

		// 1. Off by default: no logger key, so Drizzle makes no logger call per query
		expect(vi.mocked(drizzle).mock.calls[0]![1]).toStrictEqual({});

		new DatabaseDriverNeonHttp({ connection: sample.url, queryLogging: true });

		// 2. On, without a logger of its own: the query logger reports to the process logger
		const options = vi.mocked(drizzle).mock.calls[1]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(sample.processLogger.debug).toHaveBeenCalledExactlyOnceWith(
			{ query: 'select 1', paramCount: 0 },
			'Database query',
		);
	});

	test('Has nothing to close', () => {
		// 1. A fetch per query holds no connection; the manager skips a driver without `close`
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		expect('close' in driver).toBe(false);
	});
});

describe('#capabilities', () => {
	test('Declares whether transactions work', () => {
		// 1. No sessions, so an app reaches for `db.batch()`; the flag is what it reads instead of the driver name
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		expect(driver.capabilities).toStrictEqual({ transactions: false });
	});
});

describe('#label', () => {
	test('Binds the label to the logger, so the query log names the location', () => {
		// 1. A labelled driver logs through a child carrying `database`; the query logger inherits it
		const child = { error: vi.fn(), debug: vi.fn() };
		const logger = { ...sample.logger, child: vi.fn().mockReturnValue(child) };

		new DatabaseDriverNeonHttp({ connection: sample.url, label: 'main', queryLogging: true, logger: logger as never });

		expect(logger.child).toHaveBeenCalledExactlyOnceWith({ database: 'main' });

		const options = vi.mocked(drizzle).mock.calls[0]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(child.debug).toHaveBeenCalledExactlyOnceWith({ query: 'select 1', paramCount: 0 }, 'Database query');
		expect(sample.logger.debug).not.toHaveBeenCalled();
	});

	test('Leaves the logger as it is without a label', () => {
		const logger = { ...sample.logger, child: vi.fn() };

		new DatabaseDriverNeonHttp({ connection: sample.url, logger: logger as never });

		expect(logger.child).not.toHaveBeenCalled();
	});
});

describe('#ping', () => {
	test('Runs select 1 through Drizzle', async () => {
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		await driver.ping();

		expect(sample.db.execute).toHaveBeenCalledExactlyOnceWith(sql`select 1`);
	});

	test('Wraps what the query raised in DatabaseUnavailableError, naming the location', async () => {
		const driver = new DatabaseDriverNeonHttp({
			connection: sample.url,
			label: 'main',
			logger: sample.logger as never,
		});

		const error = new Error('fetch failed');

		sample.db.execute.mockRejectedValue(error);

		// 1. One error for every backend: recognisable, 503, the location in the message, the backend's error as cause
		const thrown: unknown = await driver.ping().catch((caught: unknown) => caught);

		expect(thrown).toBeInstanceOf(DatabaseUnavailableError);

		expect(thrown).toMatchObject({
			code: 'DATABASE_UNAVAILABLE',
			status: 503,
			message: 'Database "main" is unavailable: fetch failed',
			extensions: { database: 'main', reason: 'fetch failed' },
			cause: error,
		});
	});

	test('Reads without a location for a driver built by hand', async () => {
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		sample.db.execute.mockRejectedValue(new Error('fetch failed'));

		await expect(driver.ping()).rejects.toThrow('The database is unavailable: fetch failed');
	});
});

describe('#migrate', () => {
	test('Creates the journal in the given schema and applies each pending migration with its row', async () => {
		const { query, transaction } = mockClient();

		vi.mocked(readMigrationFiles).mockReturnValue([
			{ sql: ['create table "a" ()'], folderMillis: 1, hash: 'h1', bps: true },
			{ sql: ['create table "b" ()', 'create index "i" on "b" ()'], folderMillis: 2, hash: 'h2', bps: true },
		]);

		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder, migrationsSchema: 'app', migrationsTable: undefined });

		// 1. The folder is read with the options without their undefined keys
		expect(readMigrationFiles).toHaveBeenCalledExactlyOnceWith({
			migrationsFolder: sample.folder,
			migrationsSchema: 'app',
		});

		expect(query.mock.calls.slice(0, 3).map(([text]) => text)).toStrictEqual([
			'CREATE SCHEMA IF NOT EXISTS "app"',
			'CREATE TABLE IF NOT EXISTS "app"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
			'select created_at from "app"."__drizzle_migrations" order by created_at desc limit 1',
		]);

		// 2. One transaction per migration: its statements, then its journal row
		const sent = transaction.mock.calls.map(([queries]) =>
			(queries as { text: string; params?: unknown[] }[]).map(({ text, params }) => [text, params]),
		);

		// 3. Every migration runs READ WRITE, whatever transaction defaults the query function carries
		expect(transaction.mock.calls.map(([, options]) => options)).toStrictEqual([
			{ readOnly: false, deferrable: false },
			{ readOnly: false, deferrable: false },
		]);

		expect(sent).toStrictEqual([
			[
				['create table "a" ()', undefined],
				['insert into "app"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)', ['h1', 1]],
			],
			[
				['create table "b" ()', undefined],
				['create index "i" on "b" ()', undefined],
				['insert into "app"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)', ['h2', 2]],
			],
		]);
	});

	test('Skips the migrations the journal already records', async () => {
		const { transaction } = mockClient([{ created_at: '1' }]);

		vi.mocked(readMigrationFiles).mockReturnValue([
			{ sql: ['create table "a" ()'], folderMillis: 1, hash: 'h1', bps: true },
			{ sql: ['create table "b" ()'], folderMillis: 2, hash: 'h2', bps: true },
		]);

		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder });

		// 1. Only the newer one runs, recorded in Drizzle's default journal
		expect(transaction).toHaveBeenCalledOnce();

		expect(
			(transaction.mock.calls[0]![0] as { text: string; params?: unknown[] }[]).map(({ params }) => params),
		).toStrictEqual([undefined, ['h2', 2]]);
	});

	test('Stops at a failing migration with the ones before it recorded', async () => {
		const { transaction } = mockClient();
		const error = new Error('syntax error');

		// 1. The second migration's transaction fails: Neon rolls back its statements and its journal row together
		transaction.mockResolvedValueOnce([]).mockRejectedValueOnce(error);

		vi.mocked(readMigrationFiles).mockReturnValue([
			{ sql: ['create table "a" ()'], folderMillis: 1, hash: 'h1', bps: true },
			{ sql: ['bad'], folderMillis: 2, hash: 'h2', bps: true },
			{ sql: ['create table "c" ()'], folderMillis: 3, hash: 'h3', bps: true },
		]);

		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		await expect(driver.migrate({ migrationsFolder: sample.folder })).rejects.toBe(error);

		// 2. The first migration committed with its row, so a re-run resumes at the second; the third never started
		expect(transaction).toHaveBeenCalledTimes(2);
		expect((transaction.mock.calls[0]![0] as { params?: unknown[] }[]).at(-1)!.params).toStrictEqual(['h1', 1]);
	});

	test('Quotes the journal identifiers', async () => {
		const { query } = mockClient();

		vi.mocked(readMigrationFiles).mockReturnValue([]);

		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder, migrationsSchema: 'a"b', migrationsTable: 'log' });

		// 1. A quote inside a name is doubled, so it cannot close the identifier
		expect(query.mock.calls[0]![0]).toBe('CREATE SCHEMA IF NOT EXISTS "a""b"');
	});

	test('Refuses a missing folder before touching the database', async () => {
		const { query } = mockClient();
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		await expect(driver.migrate({ migrationsFolder: '' })).rejects.toThrowErrorMatchingInlineSnapshot(
			`[Error: DatabaseDriver.migrate needs a "migrationsFolder"]`,
		);

		expect(readMigrationFiles).not.toHaveBeenCalled();
		expect(query).not.toHaveBeenCalled();
	});
});
