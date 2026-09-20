import type { Env } from '../types/env.js';
import { createEnv, type CreateEnvOptions } from './create-env.js';

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
 * Building reads files and applies the cast prefixes, so it happens once; every later call returns the same object,
 * which also means all consumers see one consistent configuration. The options count on the first call only — the
 * application's schema is the one place to pass them from.
 *
 * @param options - Which variables may come from a `<NAME>_FILE`; see {@link CreateEnvOptions}.
 * @returns The cached configuration.
 * @example
 * ```ts
 * const env = envSchema.parse(useEnv({ fileVariables: Object.keys(envSchema.shape) }));
 * ```
 */
export const useEnv = (options?: CreateEnvOptions): Env => {
	// 1. Serve the cached object as long as it exists
	if (_cache.env) {
		return _cache.env;
	}

	// 2. First call: build and remember
	_cache.env = createEnv(options);

	return _cache.env;
};
