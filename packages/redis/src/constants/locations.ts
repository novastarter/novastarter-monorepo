/**
 * Name of the location configured by the plain `REDIS` / `REDIS_*` variables.
 *
 * It is implicit: it never appears in `REDIS_LOCATIONS`, and `useRedis()` without an argument resolves to it.
 *
 * @defaultValue `'default'`
 */
export const DEFAULT_REDIS_LOCATION = 'default';

/**
 * `REDIS_*` variables that configure other subsystems rather than a client.
 *
 * They are left out of the ioredis options and do not count as "Redis is configured". The list mirrors the `REDIS_*`
 * entries in the `@novastarter/env` variable list; a new namespace variable goes here as well.
 *
 * @defaultValue The location list and the four namespace variables.
 */
export const NON_CLIENT_KEYS: readonly string[] = [
	'REDIS_LOCATIONS',
	'REDIS_BUS_NAMESPACE',
	'REDIS_LOCK_NAMESPACE',
	'REDIS_COUNTERS_NAMESPACE',
	'REDIS_PERMISSIONS_NAMESPACE',
];
