import type { Pool, PoolOptions } from 'mysql2/promise';

/**
 * Whether a connection option is a ready mysql2 promise pool rather than a URI or pool options.
 *
 * Duck-typed on the two methods the driver calls, not `instanceof`: a pool from another copy of `mysql2` — an
 * application on a different version than the driver — is a pool all the same.
 *
 * @param connection - The `connection` option of a location.
 * @returns `true` for a pool.
 */
export const isPool = (connection: string | PoolOptions | Pool): connection is Pool => {
	// 1. A pool has the two methods; a URI is a string and options are a bare object without them
	return (
		typeof connection === 'object' &&
		connection !== null &&
		typeof (connection as Pool).getConnection === 'function' &&
		typeof (connection as Pool).end === 'function'
	);
};
