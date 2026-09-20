import { BusManager } from '../bus/lib/manager.js';
import { CacheManager } from '../cache/lib/manager.js';
import { KvManager } from '../kv/lib/manager.js';
import { LimiterManager } from '../limiter/lib/manager.js';

/**
 * Holders for the managers built on first use.
 *
 * Wrapped in an object rather than exported as bare bindings, so tests can reset them in place instead of reloading
 * the module; application code goes through the `use*()` accessors.
 *
 * @internal
 */
export const _cache: {
	kv: KvManager | undefined;
	cache: CacheManager | undefined;
	bus: BusManager | undefined;
	limiter: LimiterManager | undefined;
} = { kv: undefined, cache: undefined, bus: undefined, limiter: undefined };

/**
 * Return the process-wide {@link KvManager}, creating an empty one on first use.
 *
 * The application registers its locations on it at start-up; every later caller gets the same instance.
 *
 * @returns The same manager on every call.
 * @example
 * ```ts
 * useKv().registerLocation('default', {
 * 	driver: 'redis',
 * 	options: {
 * 		redis: useRedis().location('default'),
 * 		namespace: 'kv',
 * 	},
 * });
 *
 * await useKv().location('default').set('key', 'value');
 * ```
 */
export const useKv = (): KvManager => {
	// 1. One manager per process, so every consumer shares the same stores
	if (!_cache.kv) {
		_cache.kv = new KvManager();
	}

	return _cache.kv;
};

/**
 * Return the process-wide {@link CacheManager}, creating an empty one on first use.
 *
 * @returns The same manager on every call.
 */
export const useCache = (): CacheManager => {
	// 1. One manager per process, so every consumer shares the same caches
	if (!_cache.cache) {
		_cache.cache = new CacheManager();
	}

	return _cache.cache;
};

/**
 * Return the process-wide {@link BusManager}, creating an empty one on first use.
 *
 * @returns The same manager on every call.
 */
export const useBus = (): BusManager => {
	// 1. One manager per process, so publishers and subscribers meet on the same bus
	if (!_cache.bus) {
		_cache.bus = new BusManager();
	}

	return _cache.bus;
};

/**
 * Return the process-wide {@link LimiterManager}, creating an empty one on first use.
 *
 * @returns The same manager on every call.
 */
export const useLimiter = (): LimiterManager => {
	// 1. One manager per process, so every request is counted against the same limiter
	if (!_cache.limiter) {
		_cache.limiter = new LimiterManager();
	}

	return _cache.limiter;
};
