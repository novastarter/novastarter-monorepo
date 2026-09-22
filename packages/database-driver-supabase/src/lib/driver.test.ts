/**
 * Tests of `database-driver-supabase/lib/driver`.
 */
import { randDomainName, randPassword, randWord } from '@ngneat/falso';
import { DatabaseDriverPostgres } from '@novastarter/database-driver-postgres';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DatabaseDriverSupabase } from './driver.js';

vi.mock('@novastarter/database-driver-postgres');

afterEach(() => {
	vi.resetAllMocks();
});

describe('#constructor', () => {
	test('Builds the Postgres driver on the mapped options', () => {
		const url = `postgresql://postgres.${randWord()}:${randPassword()}@${randDomainName()}:6543/postgres`;

		// 1. Everything runs on the Postgres driver: the class is a subclass built with the mapped config
		const driver = new DatabaseDriverSupabase({ url, pool: { max: 2 } });

		expect(driver).toBeInstanceOf(DatabaseDriverPostgres);

		expect(DatabaseDriverPostgres).toHaveBeenCalledExactlyOnceWith({
			connection: { max: 2, connectionString: url, ssl: true },
		});
	});

	test('Throws when the url is missing, before any pool exists', () => {
		expect(() => new DatabaseDriverSupabase({ url: '' })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The supabase database driver needs a "url"]`,
		);

		expect(DatabaseDriverPostgres).not.toHaveBeenCalled();
	});
});
