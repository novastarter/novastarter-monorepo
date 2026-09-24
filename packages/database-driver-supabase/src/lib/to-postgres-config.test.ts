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
	// The URL has the shape of the dashboard's transaction-pooler string
	sample = {
		url: `postgresql://postgres.${randWord()}:${randPassword()}@pooler.${randDomainName()}:6543/postgres`,
		ca: `-----BEGIN CERTIFICATE-----\n${randPassword()}\n-----END CERTIFICATE-----`,
	};
});

describe('toPostgresConfig', () => {
	test('Throws when the url is missing', () => {
		expect(() => toPostgresConfig({ url: '' })).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The supabase database driver needs a "url".]`,
		);
	});

	test('Throws when the url is not a valid URL', () => {
		// `new URL` would raise a bare `TypeError: Invalid URL` — the driver names the option at fault instead
		expect(() => toPostgresConfig({ url: 'not-a-url' })).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The supabase database driver needs a "url" that is a valid URL.]`,
		);
	});

	test('Turns the url into a pool on TLS by default', () => {
		// `toStrictEqual`: no key of the driver's own may leak through, and nothing undefined may be added
		expect(toPostgresConfig({ url: sample.url })).toStrictEqual({
			connection: { connectionString: sample.url, ssl: true },
		});
	});

	test('Lays the certificate over TLS as its ca', () => {
		expect(toPostgresConfig({ url: sample.url, ca: sample.ca })).toStrictEqual({
			connection: { connectionString: sample.url, ssl: { ca: sample.ca } },
		});

		expect(toPostgresConfig({ url: sample.url, ssl: { servername: 'db' }, ca: sample.ca }).connection).toStrictEqual({
			connectionString: sample.url,
			ssl: { servername: 'db', ca: sample.ca },
		});
	});

	test('Treats a blank certificate as absent', () => {
		// An empty string would otherwise replace Node's default root store and verify against nothing — the shape
		// an env var that exists but is blank produces
		expect(toPostgresConfig({ url: sample.url, ca: '' })).toStrictEqual({
			connection: { connectionString: sample.url, ssl: true },
		});

		// Whitespace-only is blank too: it would replace Node's root store just the same and fail every connection
		expect(toPostgresConfig({ url: sample.url, ca: ' \n\t ' })).toStrictEqual({
			connection: { connectionString: sample.url, ssl: true },
		});
	});

	test('Trims whitespace around the certificate', () => {
		// A PEM copied with surrounding whitespace is used as given, trimmed — not passed on to replace Node's root
		// store with a value that is not a certificate
		expect(toPostgresConfig({ url: sample.url, ca: ` \n${sample.ca}\n ` })).toStrictEqual({
			connection: { connectionString: sample.url, ssl: { ca: sample.ca } },
		});
	});

	test('Throws when the url carries an sslmode parameter', () => {
		// node-postgres lets the URL override the `ssl` option, so an sslmode there would silently defeat the TLS
		// set here — refused up front, in the words of this driver
		expect(() => toPostgresConfig({ url: `${sample.url}?sslmode=disable` })).toThrowErrorMatchingInlineSnapshot(
			`[NovastarterError: Invalid config. The supabase database driver needs a "url" without TLS parameters ("ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "sslnegotiation"): set TLS with "ssl" and "ca" instead.]`,
		);
	});

	test.each(['ssl=0', 'ssl=1', 'ssl=true'] as const)('Throws when the url carries %s', (param) => {
		// pg turns `ssl=0` into `ssl: false` and `ssl=1`/`ssl=true` into `ssl: true` over the `ssl` option, so the
		// first would connect in plain text and the others would drop the `ca` — refused like sslmode
		expect(() => toPostgresConfig({ url: `${sample.url}?${param}`, ca: sample.ca })).toThrow(
			'The supabase database driver needs a "url" without TLS parameters',
		);
	});

	test.each(['sslcert', 'sslkey', 'sslrootcert', 'sslnegotiation'] as const)(
		'Throws when the url carries a %s parameter',
		(param) => {
			// pg parses these out of the connection string over the `ssl` option, so any of them would silently
			// defeat the TLS set here — refused like sslmode
			expect(() => toPostgresConfig({ url: `${sample.url}?${param}=x` })).toThrow(
				'The supabase database driver needs a "url" without TLS parameters',
			);
		},
	);

	test('Passes TLS options and an explicit off through', () => {
		expect(toPostgresConfig({ url: sample.url, ssl: { rejectUnauthorized: false } }).connection).toStrictEqual({
			connectionString: sample.url,
			ssl: { rejectUnauthorized: false },
		});

		// Off stays off even with a certificate: the local CLI stack has no TLS to verify against it
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
			toPostgresConfig({ url: sample.url, schema, casing: 'snake_case', logger, queryLogging: true, label: 'main' }),
		).toStrictEqual({
			connection: { connectionString: sample.url, ssl: true },
			schema,
			casing: 'snake_case',
			logger,
			queryLogging: true,
			label: 'main',
		});
	});
});
