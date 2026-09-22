import { type Singleton, singleton } from '@novastarter/utils';
import type { Env } from '../types/env.js';
import { createEnv, type CreateEnvOptions } from './create-env.js';

/**
 * Return the process configuration, building it on the first call.
 *
 * Building reads files and applies the cast prefixes, so it happens once; every later call returns the same object,
 * which also means all consumers see one consistent configuration. The options belong to the call that builds — the
 * application's boot is the one place to pass them from; every other caller passes none, and one that passes options
 * to a configuration already built is refused, since they would have no say.
 *
 * @param options - Which variables may come from a `<NAME>_FILE`; see {@link CreateEnvOptions}. Only on the first call.
 * @returns The cached configuration; `useEnv.reset()` drops it, for tests.
 * @throws Error when options are passed once the configuration exists.
 * @example
 * ```ts
 * const env = envSchema.parse(useEnv({ fileVariables: Object.keys(envSchema.shape) }));
 * ```
 */
export const useEnv: Singleton<Env, [options?: CreateEnvOptions]> = singleton((options?: CreateEnvOptions) =>
	createEnv(options),
);
