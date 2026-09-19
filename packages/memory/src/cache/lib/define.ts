import type { Cache } from '../types/class.js';
import type { CacheConfig } from '../types/config.js';
import { createCache } from './create.js';

/**
 * Build a lazy singleton accessor for a cache.
 *
 * The cache is only created on the first call, so a module can declare its cache at import time without opening a
 * Redis connection until something actually uses it.
 *
 * @param config - Configuration handed to {@link createCache} on first use.
 * @returns Function returning the same cache instance on every call.
 * @example
 * ```ts
 * const useCache = defineCache({ type: 'local' });
 *
 * await useCache().set('my-key', 'my-value');
 * ```
 */
export const defineCache = (config: CacheConfig): (() => Cache) => {
	let cache: Cache;

	/**
	 * Return the cache, creating it on the first call.
	 *
	 * @returns The shared cache instance.
	 */
	const useCache = (): Cache => {
		// 1. Reuse the instance once it exists; creating a second one would open a second connection
		if (cache) return cache;

		// 2. First use: build it from the captured config
		cache = createCache(config);

		return cache;
	};

	return useCache;
};
