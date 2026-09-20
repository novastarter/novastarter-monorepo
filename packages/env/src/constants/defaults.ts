import { resolve } from 'node:path';
import { cwd } from 'node:process';
import type { Env } from '../types/env.js';

/**
 * Fallback values of the variables the package itself reads.
 *
 * Applied before the process environment and the config file, so anything set there wins. Defaults of the
 * application's own variables belong in its schema, not here.
 *
 * @defaultValue `CONFIG_PATH` resolves to `.env` in the working directory.
 */
export const DEFAULTS: Env = {
	CONFIG_PATH: resolve(cwd(), '.env'),
};
