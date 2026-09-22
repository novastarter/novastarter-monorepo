/**
 * Tests of `database-driver-neon/lib/driver-http`.
 */
import { neon } from '@neondatabase/serverless';
import { randDirectoryPath, randDomainName, randPassword, randUserName, randWord } from '@ngneat/falso';
import { useLogger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverNeonHttp, type NeonHttpClient } from './driver-http.js';

// A factory rather than an automock: `neonConfig` is a class of static accessors, and only `neon` is needed
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn() }));
vi.mock('@novastarter/logger', () => ({ useLogger: vi.fn() }));
vi.mock('drizzle-orm/neon-http', () => ({ drizzle: vi.fn() }));
vi.mock('drizzle-orm/neon-http/migrator', () => ({ migrate: vi.fn() }));

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	url: string;
	folder: string;
	logger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	processLogger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	client: NeonHttpClient;
	db: { execute: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
	// 1. Fresh values per test; the client is a function, as `neon()` answers with one
	sample = {
		url: `postgresql://${randUserName()}:${randPassword()}@ep-${randWord()}.${randDomainName()}/neondb?sslmode=require`,
		folder: randDirectoryPath(),
		logger: { error: vi.fn(), debug: vi.fn() },
		processLogger: { error: vi.fn(), debug: vi.fn() },
		client: vi.fn() as unknown as NeonHttpClient,
		db: { execute: vi.fn() },
	};

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
			{ query: 'select 1', params: [] },
			'Database query',
		);
	});

	test('Has nothing to close', () => {
		// 1. A fetch per query holds no connection; the manager skips a driver without `close`
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		expect('close' in driver).toBe(false);
	});
});

describe('#ping', () => {
	test('Runs select 1 through Drizzle', async () => {
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		await driver.ping();

		expect(sample.db.execute).toHaveBeenCalledExactlyOnceWith(sql`select 1`);
	});

	test('Rethrows what the request raised', async () => {
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });
		const error = new Error('fetch failed');

		sample.db.execute.mockRejectedValue(error);

		await expect(driver.ping()).rejects.toBe(error);
	});
});

describe('#migrate', () => {
	test('Runs the Neon HTTP migrator over the folder', async () => {
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		await driver.migrate({ migrationsFolder: sample.folder, migrationsSchema: 'app', migrationsTable: undefined });

		// 1. The Drizzle database goes in as is, the options without their undefined keys
		expect(migrate).toHaveBeenCalledExactlyOnceWith(sample.db, {
			migrationsFolder: sample.folder,
			migrationsSchema: 'app',
		});
	});

	test('Refuses a missing folder before touching the database', async () => {
		const driver = new DatabaseDriverNeonHttp({ connection: sample.url, logger: sample.logger as never });

		await expect(driver.migrate({ migrationsFolder: '' })).rejects.toThrowErrorMatchingInlineSnapshot(
			`[Error: DatabaseDriver.migrate needs a "migrationsFolder"]`,
		);

		expect(migrate).not.toHaveBeenCalled();
	});
});
