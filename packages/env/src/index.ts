/**
 * Entry point of `@novastarter/env`.
 *
 * {@link useEnv} hands out the one parsed configuration object — an {@link Env} — read once from the process
 * environment and the optional config file, cast to typed values, with `*_FILE` secrets loaded from disk. The readers,
 * casting and constants behind it stay internal, so the way configuration is sourced can change without touching
 * consumers. Packages never read the environment themselves: the application reads the values it needs from
 * `useEnv()` and hands them over explicitly when it registers drivers and locations at start-up.
 */
export { useEnv } from './lib/use-env.js';
export type { Env } from './types/env.js';
