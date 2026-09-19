import type { Redis } from 'ioredis';

/**
 * Options every bus configuration shares.
 */
export interface BusConfigAbstract {
	/**
	 * Where the messages travel through.
	 *
	 * `local` - Local memory. Only intended for single-process instances.
	 * `redis` - Redis instance
	 */
	type: 'local' | 'redis';
}

/**
 * Configuration of the in-process bus; it has no options.
 */
export interface BusConfigLocal extends BusConfigAbstract {
	type: 'local';
}

/**
 * Configuration of the Redis-backed bus.
 */
export interface BusConfigRedis extends BusConfigAbstract {
	type: 'redis';

	/**
	 * Prefix for every channel name in Redis.
	 */
	namespace: string;

	/**
	 * Enable gzip compression of published payloads.
	 *
	 * @default true
	 */
	compression?: boolean;

	/**
	 * Minimum byte size of a payload before it is compressed.
	 *
	 * There is a trade-off between size and the time spent gzipping; below roughly 1 kB the savings do not pay for
	 * the CPU time.
	 *
	 * @default 1000
	 */
	compressionMinSize?: number;

	/**
	 * Existing or new Redis connection to publish through; a duplicate of it is opened for subscribing.
	 */
	redis: Redis;
}

/**
 * Union of the supported bus configurations, discriminated by `type`.
 */
export type BusConfig = BusConfigLocal | BusConfigRedis;
