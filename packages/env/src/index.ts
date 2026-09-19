/**
 * Entry point of `@novastarter/env`.
 *
 * Only {@link useEnv} is public: it hands out the one parsed configuration object. The readers, casting and constants
 * behind it stay internal, so the way configuration is sourced can change without touching consumers.
 */
export { useEnv } from './lib/use-env.js';
