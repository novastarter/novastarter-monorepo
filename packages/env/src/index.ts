/**
 * Entry point of `@novastarter/env`.
 *
 * {@link useEnv} hands out the one parsed configuration object and {@link getConfigFromEnv} collects a prefixed
 * family of variables out of it. The readers, casting and constants behind them stay internal, so the way
 * configuration is sourced can change without touching consumers.
 */
export { useEnv } from './lib/use-env.js';
export { type GetConfigFromEnvOptions, getConfigFromEnv } from './utils/get-config-from-env.js';
