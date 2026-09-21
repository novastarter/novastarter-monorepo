import type { Redis } from 'ioredis';

/**
 * Options of the in-process bus, the `local` driver; it has none.
 */
export type BusDriverLocalConfig = Record<string, never>;

/**
 * Options of the Redis-backed bus, the `redis` driver.
 */
export type BusDriverRedisConfig = {
	/**
	 * Prefix for every channel name in Redis.
	 */
	namespace: string;

	/**
	 * Enable gzip compression of published payloads.
	 *
	 * @default true
	 */
	compression?: boolean | undefined;

	/**
	 * Minimum byte size of a payload before it is compressed.
	 *
	 * There is a trade-off between size and the time spent gzipping; below roughly 1 kB the savings do not pay for
	 * the CPU time.
	 *
	 * @default 1000
	 */
	compressionMinSize?: number | undefined;

	/**
	 * Existing or new Redis connection to publish through; a duplicate of it is opened for subscribing.
	 */
	redis: Redis;
};
