import { ENV_TYPES } from '../constants/env-types.js';

/**
 * One of the casting types a variable can be coerced to.
 *
 * Derived from {@link ENV_TYPES}, so the list of types exists in exactly one place.
 */
export type EnvType = (typeof ENV_TYPES)[number];
