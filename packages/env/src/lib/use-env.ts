import { type Singleton, singleton } from '@novastarter/utils';
import type { Env } from '../types/env.js';
import { createEnv, type CreateEnvOptions } from './create-env.js';

/**
 * Return the process configuration, building it on the first call.
 *
 * Building reads files and applies the cast prefixes, so it happens once; every later call returns the same object,
 * which also means all consumers see one consistent configuration. The options count on the first call only — the
 * application's schema is the one place to pass them from.
 *
 * @param options - Which variables may come from a `<NAME>_FILE`; see {@link CreateEnvOptions}.
 * @returns The cached configuration; `useEnv.reset()` drops it, for tests.
 * @example
 * ```ts
 * const env = envSchema.parse(useEnv({ fileVariables: Object.keys(envSchema.shape) }));
 * ```
 */
export const useEnv: Singleton<Env, [options?: CreateEnvOptions]> = singleton((options?: CreateEnvOptions) =>
	createEnv(options),
);
