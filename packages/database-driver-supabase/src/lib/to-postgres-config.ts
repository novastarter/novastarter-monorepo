import type { ConnectionOptions } from 'node:tls';
import type { DatabaseDriverCommonConfig } from '@novastarter/database';
import type { DatabaseDriverPostgresConfig } from '@novastarter/database-driver-postgres';
import type { PoolConfig } from 'pg';

/**
 * Options accepted by {@link DatabaseDriverSupabase}.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 */
export type DatabaseDriverSupabaseConfig<Schema extends Record<string, unknown> = Record<string, unknown>> =
	DatabaseDriverCommonConfig<Schema> & {
		/**
		 * The connection string from the project's dashboard: the direct host, the session pooler (port 5432) or the
		 * transaction pooler (port 6543). Without an `sslmode` parameter — node-postgres lets the URL override the
		 * `ssl` option, so TLS is set with `ssl` and `ca` here instead.
		 */
		url: string;
		/**
		 * TLS: `true` encrypts and verifies the server against the system's root certificates, an object goes to
		 * node-postgres as it is, `false` is for the local Supabase CLI stack, which speaks plain TCP.
		 *
		 * @defaultValue true
		 */
		ssl?: boolean | ConnectionOptions | undefined;
		/**
		 * PEM of Supabase's root certificate (`prod-ca-2021.crt` under the project's database settings), for a server
		 * whose certificate does not chain to a public root; laid over `ssl` as its `ca`.
		 */
		ca?: string | undefined;
		/** Further pool options; `connectionString` and `ssl` are taken from `url`, `ssl` and `ca`. */
		pool?: Omit<PoolConfig, 'connectionString' | 'ssl'> | undefined;
	};

/**
 * Resolve the `ssl` option node-postgres gets from the driver's `ssl` and `ca`.
 *
 * @param ssl - The driver's `ssl` option; `true` when omitted.
 * @param ca - The driver's `ca` option.
 * @returns What goes into the pool's `ssl`.
 * @internal
 */
const resolveSsl = (ssl: boolean | ConnectionOptions = true, ca?: string): boolean | ConnectionOptions => {
	// 1. Off is off: a certificate given next to it would be a contradiction, and the CLI stack has no TLS to verify
	if (ssl === false) {
		return false;
	}

	// 2. A certificate turns `true` into TLS options and joins the ones given, so verification runs against it
	if (ca !== undefined) {
		return { ...(typeof ssl === 'object' ? ssl : {}), ca };
	}

	return ssl;
};

/**
 * Turn the Supabase options into what the Postgres driver takes.
 *
 * Pure, so the mapping can be tested without a pool: the URL becomes the pool's `connectionString`, `ssl` and `ca`
 * its `ssl`, `pool` its other options, and the options every driver shares go through as they are.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @param config - The Supabase options.
 * @returns The Postgres driver's options.
 * @throws Error when `url` is missing.
 * @example
 * ```ts
 * super(toPostgresConfig(config));
 * ```
 */
export const toPostgresConfig = <Schema extends Record<string, unknown>>(
	config: DatabaseDriverSupabaseConfig<Schema>,
): DatabaseDriverPostgresConfig<Schema> => {
	// 1. Refuse a missing URL up front, in the words of this driver; the Postgres one would speak of a `connection`
	//    nobody configured
	if (!config.url) {
		throw new Error('The supabase database driver needs a "url"');
	}

	// 2. The shared options pass through untouched; the four of this driver become one pool config
	const { url, ssl, ca, pool, ...common } = config;

	return {
		...common,
		connection: {
			...pool,
			connectionString: url,
			ssl: resolveSsl(ssl, ca),
		},
	};
};
