/**
 * Entry point of `@novastarter/env`.
 *
 * {@link useEnv} hands out the one configuration object — an {@link Env} — read once from the process environment
 * and the optional config file, cast prefixes applied, with the `*_FILE` secrets of the application's variables
 * loaded from disk. The readers and constants behind it stay internal, so the way configuration is sourced can change
 * without touching consumers. Packages never read the environment themselves: the application parses `useEnv()`
 * with its own schema and hands the values over explicitly when it registers drivers and locations at start-up.
 */
export { type CreateEnvOptions } from './lib/create-env.js';
export { useEnv } from './lib/use-env.js';
export type { Env } from './types/env.js';
