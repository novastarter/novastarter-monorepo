import type { Client, Config } from '@libsql/client';

/**
 * Whether a connection option is a ready libsql client rather than a URL or a client config.
 *
 * Duck-typed on the two methods the driver calls, not `instanceof`: a client from another copy of `@libsql/client` —
 * an application on a different version than the driver — is a client all the same.
 *
 * @param connection - The `connection` option of a location.
 * @returns `true` for a client.
 */
export const isClient = (connection: string | Config | Client): connection is Client => {
	// 1. A client has the two methods; a URL is a string and a config is a bare object without them
	return (
		typeof connection === 'object' &&
		connection !== null &&
		typeof (connection as Client).execute === 'function' &&
		typeof (connection as Client).close === 'function'
	);
};
