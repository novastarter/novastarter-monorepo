import type { Env } from '../types/env.js';
import { createEnv } from './create-env.js';

/**
 * Holder for the configuration built on first use.
 *
 * Exported so tests can reset it between cases; application code goes through {@link useEnv}.
 *
 * @internal
 */
export const _cache: {
	env: Env | undefined;
} = { env: undefined } as const;

/**
 * Return the process configuration, building it on the first call.
 *
 * Building reads files and casts every value, so it happens once; every later call returns the same object, which
 * also means all consumers see one consistent configuration.
 *
 * @returns The cached configuration.
 * @example
 * ```ts
 * const env = useEnv();
 *
 * const port = env['PORT'];
 * ```
 */
export const useEnv = (): Env => {
	// 1. Serve the cached object as long as it exists
	if (_cache.env) {
		return _cache.env;
	}

	// 2. First call: build and remember
	_cache.env = createEnv();

	return _cache.env;
};
