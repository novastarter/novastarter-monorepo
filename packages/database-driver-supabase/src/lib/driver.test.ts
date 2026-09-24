/**
 * Tests of `database-driver-supabase/lib/driver`.
 *
 * The parent Postgres driver is not mocked: these tests build the real driver over a pool that opens its connections
 * lazily, so what they assert is this subclass's own behaviour — the mapped options reaching node-postgres and the
 * inherited capabilities surviving the `declare` field.
 */
import { randDomainName, randPassword, randWord } from '@ngneat/falso';
import { describe, expect, test, vi } from 'vitest';
import { DatabaseDriverSupabase } from './driver.js';

describe('#constructor', () => {
	test('Builds the Postgres driver on the mapped options', () => {
		const url = `postgresql://postgres.${randWord()}:${randPassword()}@${randDomainName()}:6543/postgres`;

		// Everything runs on the Postgres driver: the pool it opens answers the mapped config, and the pool is
		// reachable as `db.$client` the way the contract types it
		const driver = new DatabaseDriverSupabase({
			url,
			pool: { max: 2 },
			logger: { error: vi.fn(), debug: vi.fn() } as never,
		});

		expect(driver.db.$client.options).toMatchObject({ max: 2, connectionString: url, ssl: true });
	});

	test('Throws when the url is missing, before any pool exists', () => {
		// The mapping throws before the parent constructor runs, so no pool is opened for a driver that cannot exist
		expect(() => new DatabaseDriverSupabase({ url: '' })).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The supabase database driver needs a "url".]`,
		);
	});
});

describe('#capabilities', () => {
	test('Declares whether transactions work', () => {
		// The field is declared, not redefined: with `useDefineForClassFields` a plain field would shadow the
		// inherited value with `undefined`, and this assertion is what catches a lost `declare`
		const driver = new DatabaseDriverSupabase({
			url: `postgresql://postgres.${randWord()}:${randPassword()}@${randDomainName()}:6543/postgres`,
			logger: { error: vi.fn(), debug: vi.fn() } as never,
		});

		expect(driver.capabilities).toStrictEqual({ transactions: true });
	});
});
