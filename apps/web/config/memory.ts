import type { BusDrivers, CacheDrivers, KvDrivers, LimiterDrivers } from '@novastarter/memory';
import type { LocationConfig } from '@novastarter/utils';
import type { Redis } from 'ioredis';

/**
 * The memory locations of the app: one of each kind, on Redis when there is one and in-process otherwise.
 */
export interface MemoryConfig {
	kv: Record<string, LocationConfig<KvDrivers>>;
	cache: Record<string, LocationConfig<CacheDrivers>>;
	bus: Record<string, LocationConfig<BusDrivers>>;
	limiter: Record<string, LocationConfig<LimiterDrivers>>;
}

/**
 * Memory locations by kind and name.
 *
 * @param redis - The shared Redis client, when the app has one.
 * @returns The locations to register.
 */
export const memoryConfig = (redis: Redis | undefined): MemoryConfig => {
	// 1. With a server every location shares its client, so all processes of the deployment see the same data
	if (redis) {
		return {
			kv: { default: { driver: 'redis', options: { redis, namespace: 'kv' } } },
			cache: { default: { driver: 'redis', options: { redis, namespace: 'cache', ttl: 60_000 } } },
			bus: { default: { driver: 'redis', options: { redis, namespace: 'bus' } } },
			limiter: { api: { driver: 'redis', options: { redis, namespace: 'limiter', points: 50, duration: 1 } } },
		};
	}

	// 2. Without one, everything stays in the process: development, tests, a single instance
	return {
		kv: { default: { driver: 'local', options: {} } },
		cache: { default: { driver: 'local', options: { maxKeys: 500, ttl: 60_000 } } },
		bus: { default: { driver: 'local', options: {} } },
		limiter: { api: { driver: 'local', options: { points: 50, duration: 1 } } },
	};
};
