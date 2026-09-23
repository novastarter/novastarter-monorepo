import type { Env } from '../types/env.js';

/**
 * Fallback values of the variables the package itself reads.
 *
 * Applied before the process environment and the config file, so anything set there wins. Defaults of the
 * application's own variables belong in its schema, not here.
 *
 * `CONFIG_PATH` is kept relative and resolved against the working directory when `getConfigPath` reads it, so an
 * application that changes directory between import and the first `useEnv()` still reads the config file of the
 * directory it ends up in.
 *
 * @defaultValue `CONFIG_PATH` is `.env`, resolved to the working directory at lookup time.
 */
export const DEFAULTS: Env = {
	CONFIG_PATH: '.env',
};
