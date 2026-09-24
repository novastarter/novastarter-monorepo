import type { BusDrivers, CacheDrivers, KvDrivers, LimiterDrivers } from '@novastarter/memory';
import type { LocationConfig } from '@novastarter/utils';
import type { Redis } from 'ioredis';

/**
 * The memory locations of the app: one of each kind, on Redis when there is one and in-process otherwise.
 */
export interface MemoryConfig {
	kv: LocationConfig<KvDrivers>;
	cache: LocationConfig<CacheDrivers>;
	bus: LocationConfig<BusDrivers>;
	limiter: LocationConfig<LimiterDrivers>;
}

/**
 * One memory location per kind — what the bootstrap registers as `default`, and as `api` for the limiter.
 *
 * @param redis - The shared Redis client, when the app has one.
 * @returns The locations to register.
 */
export const memoryConfig = (redis: Redis | undefined): MemoryConfig => {
	// With a server every location shares its client, so all processes of the deployment see the same data
	if (redis) {
		return {
			kv: {
				driver: 'redis',
				options: {
					redis,
					namespace: 'kv',
				},
			},
			cache: {
				driver: 'redis',
				options: {
					redis,
					namespace: 'cache',
					ttl: 60_000,
				},
			},
			bus: {
				driver: 'redis',
				options: {
					redis,
					namespace: 'bus',
				},
			},
			limiter: {
				driver: 'redis',
				options: {
					redis,
					namespace: 'limiter',
					points: 50,
					duration: 1,
				},
			},
		};
	}

	// Without one, everything stays in the process: development, tests, a single instance
	return {
		kv: {
			driver: 'local',
			options: {},
		},
		cache: {
			driver: 'local',
			options: {
				maxKeys: 500,
				ttl: 60_000,
			},
		},
		bus: {
			driver: 'local',
			options: {},
		},
		limiter: {
			driver: 'local',
			options: {
				points: 50,
				duration: 1,
			},
		},
	};
};
