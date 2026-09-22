/**
 * Tests of `database-driver-supabase/lib/to-postgres-config`.
 */
import { randDomainName, randPassword, randWord } from '@ngneat/falso';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { toPostgresConfig } from './to-postgres-config.js';

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: { url: string; ca: string };

beforeEach(() => {
	// 1. The URL has the shape of the dashboard's transaction-pooler string
	sample = {
		url: `postgresql://postgres.${randWord()}:${randPassword()}@pooler.${randDomainName()}:6543/postgres`,
		ca: `-----BEGIN CERTIFICATE-----\n${randPassword()}\n-----END CERTIFICATE-----`,
	};
});

describe('toPostgresConfig', () => {
	test('Throws when the url is missing', () => {
		expect(() => toPostgresConfig({ url: '' })).toThrowErrorMatchingInlineSnapshot(
			`[Error: The supabase database driver needs a "url"]`,
		);
	});

	test('Turns the url into a pool on TLS by default', () => {
		// 1. `toStrictEqual`: no key of the driver's own may leak through, and nothing undefined may be added
		expect(toPostgresConfig({ url: sample.url })).toStrictEqual({
			connection: { connectionString: sample.url, ssl: true },
		});
	});

	test('Lays the certificate over TLS as its ca', () => {
		expect(toPostgresConfig({ url: sample.url, ca: sample.ca })).toStrictEqual({
			connection: { connectionString: sample.url, ssl: { ca: sample.ca } },
		});

		// 1. Given TLS options keep what they carry, the certificate joins them
		expect(toPostgresConfig({ url: sample.url, ssl: { servername: 'db' }, ca: sample.ca }).connection).toStrictEqual({
			connectionString: sample.url,
			ssl: { servername: 'db', ca: sample.ca },
		});
	});

	test('Passes TLS options and an explicit off through', () => {
		expect(toPostgresConfig({ url: sample.url, ssl: { rejectUnauthorized: false } }).connection).toStrictEqual({
			connectionString: sample.url,
			ssl: { rejectUnauthorized: false },
		});

		// 1. Off stays off even with a certificate: the local CLI stack has no TLS to verify against it
		expect(toPostgresConfig({ url: sample.url, ssl: false, ca: sample.ca }).connection).toStrictEqual({
			connectionString: sample.url,
			ssl: false,
		});
	});

	test('Merges the pool options under the connection string', () => {
		expect(toPostgresConfig({ url: sample.url, pool: { max: 4, idleTimeoutMillis: 1000 } }).connection).toStrictEqual({
			max: 4,
			idleTimeoutMillis: 1000,
			connectionString: sample.url,
			ssl: true,
		});
	});

	test('Passes the shared options through as they are', () => {
		const schema = { users: {} };
		const logger = { error: vi.fn() } as never;

		expect(
			toPostgresConfig({ url: sample.url, schema, casing: 'snake_case', logger, queryLogging: true }),
		).toStrictEqual({
			connection: { connectionString: sample.url, ssl: true },
			schema,
			casing: 'snake_case',
			logger,
			queryLogging: true,
		});
	});
});
