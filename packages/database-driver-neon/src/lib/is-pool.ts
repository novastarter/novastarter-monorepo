import type { Pool, PoolConfig } from '@neondatabase/serverless';

/**
 * Whether a connection option is a ready Neon pool rather than a URL or pool options.
 *
 * Duck-typed on the two methods the driver calls, not `instanceof`: a pool from another copy of
 * `@neondatabase/serverless` — an application on a different version than the driver — is a pool all the same.
 *
 * @param connection - The `connection` option of a location.
 * @returns `true` for a pool.
 */
export const isPool = (connection: string | PoolConfig | Pool): connection is Pool => {
	// 1. A pool has the two methods; a URL is a string and options are a bare object without them
	return (
		typeof connection === 'object' &&
		connection !== null &&
		typeof (connection as Pool).connect === 'function' &&
		typeof (connection as Pool).end === 'function'
	);
};
