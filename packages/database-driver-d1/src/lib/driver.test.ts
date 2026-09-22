/**
 * Tests of `database-driver-d1/lib/driver`.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { randDirectoryPath } from '@ngneat/falso';
import { useLogger } from '@novastarter/logger';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { migrate } from 'drizzle-orm/d1/migrator';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverD1 } from './driver.js';

vi.mock('@novastarter/logger', () => ({ useLogger: vi.fn() }));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('drizzle-orm/d1/migrator', () => ({ migrate: vi.fn() }));

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	folder: string;
	logger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	processLogger: { error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
	binding: D1Database;
	db: { run: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
	// 1. Fresh values per test; the binding has the members of D1's API, none of which the driver itself calls
	sample = {
		folder: randDirectoryPath(),
		logger: { error: vi.fn(), debug: vi.fn() },
		processLogger: { error: vi.fn(), debug: vi.fn() },
		binding: { prepare: vi.fn(), batch: vi.fn(), exec: vi.fn(), withSession: vi.fn(), dump: vi.fn() } as never,
		db: { run: vi.fn() },
	};

	// 2. `drizzle` answers a bare object: only `run` is called, and the migrator is mocked whole
	vi.mocked(drizzle).mockReturnValue(sample.db as never);
	vi.mocked(useLogger).mockReturnValue(sample.processLogger as never);
});

afterEach(() => {
	// 1. Reset call history and implementations, so a `mockReturnValue` set in one test cannot leak into the next
	vi.resetAllMocks();
});

describe('#constructor', () => {
	test('Throws when the binding is missing', () => {
		// 1. Without one Drizzle would fail on the first query, far from the wrangler configuration at fault
		expect(() => new DatabaseDriverD1({ binding: undefined as never })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The d1 database driver needs a "binding"]`,
		);
	});

	test('Builds the Drizzle database over the binding with the schema and casing', () => {
		const schema = { notes: {} };

		const driver = new DatabaseDriverD1({
			binding: sample.binding,
			schema,
			casing: 'snake_case',
			logger: sample.logger as never,
		});

		// 1. Drizzle gets the binding as it is and only the options that carry a value
		expect(drizzle).toHaveBeenCalledExactlyOnceWith(sample.binding, { schema, casing: 'snake_case' });
		expect(driver.db).toBe(sample.db);
	});

	test('Hands Drizzle a query logger on the process logger only when asked for', () => {
		new DatabaseDriverD1({ binding: sample.binding });

		// 1. Off by default: no logger key, so Drizzle makes no logger call per query
		expect(vi.mocked(drizzle).mock.calls[0]![1]).toStrictEqual({});

		new DatabaseDriverD1({ binding: sample.binding, queryLogging: true });

		// 2. On, without a logger of its own: the query logger reports to the process logger
		const options = vi.mocked(drizzle).mock.calls[1]![1]!;

		(options.logger as { logQuery(query: string, params: unknown[]): void }).logQuery('select 1', []);

		expect(sample.processLogger.debug).toHaveBeenCalledExactlyOnceWith(
			{ query: 'select 1', params: [] },
			'Database query',
		);
	});

	test('Has nothing to close', () => {
		// 1. The binding is the platform's; the manager skips a driver without `close`
		const driver = new DatabaseDriverD1({ binding: sample.binding, logger: sample.logger as never });

		expect('close' in driver).toBe(false);
	});
});

describe('#ping', () => {
	test('Runs select 1 through Drizzle', async () => {
		const driver = new DatabaseDriverD1({ binding: sample.binding, logger: sample.logger as never });

		await driver.ping();

		// 1. Through `db.run`, so the same path the application's statements take is what gets proven
		expect(sample.db.run).toHaveBeenCalledExactlyOnceWith(sql`select 1`);
	});

	test('Rethrows what D1 raised', async () => {
		const driver = new DatabaseDriverD1({ binding: sample.binding, logger: sample.logger as never });
		const error = new Error('D1_ERROR');

		sample.db.run.mockRejectedValue(error);

		await expect(driver.ping()).rejects.toBe(error);
	});
});

describe('#migrate', () => {
	test('Runs the D1 migrator over the folder', async () => {
		const driver = new DatabaseDriverD1({ binding: sample.binding, logger: sample.logger as never });

		await driver.migrate({
			migrationsFolder: sample.folder,
			migrationsTable: 'migrations',
			migrationsSchema: undefined,
		});

		// 1. The Drizzle database goes in as is, the options without their undefined keys
		expect(migrate).toHaveBeenCalledExactlyOnceWith(sample.db, {
			migrationsFolder: sample.folder,
			migrationsTable: 'migrations',
		});
	});

	test('Refuses a missing folder before touching the database', async () => {
		const driver = new DatabaseDriverD1({ binding: sample.binding, logger: sample.logger as never });

		await expect(driver.migrate({ migrationsFolder: '' })).rejects.toThrowErrorMatchingInlineSnapshot(
			`[Error: DatabaseDriver.migrate needs a "migrationsFolder"]`,
		);

		expect(migrate).not.toHaveBeenCalled();
	});
});
