/**
 * Parsed configuration, keyed by variable name.
 *
 * Values are `unknown` because every entry is cast to its own type (number, boolean, array, regex, JSON) before it
 * lands here; the consumer narrows the value it reads.
 */
export type Env = Record<string, unknown>;
