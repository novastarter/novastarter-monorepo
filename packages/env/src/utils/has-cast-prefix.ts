import { isIn } from '@novastarter/utils';
import { ENV_TYPES } from '../constants/env-types.js';

/**
 * Extract the cast prefix from a value such as `number:8055`.
 *
 * Only the segment before the first colon is checked, so a URL like `https://…` yields no flag because `https` is
 * not a known type.
 *
 * @param value - Raw value.
 * @returns The type named by the prefix, or `null` when the value is not a string or has no known prefix.
 * @example
 * ```ts
 * getCastFlag('array:a,b');
 * // => 'array'
 *
 * getCastFlag('https://example.com');
 * // => null
 * ```
 */
export const getCastFlag = (value: unknown): (typeof ENV_TYPES)[number] | null => {
	// 1. Prefixes only exist in strings; numbers and objects from a JS/YAML config are already typed
	if (typeof value !== 'string') return null;

	// 2. Without a colon there is nothing that could be a prefix
	if (value.includes(':') === false) return null;

	// 3. The first segment is the candidate; the tuple cast tells TS a split always yields at least one element
	const castPrefix = (value.split(':') as [string])[0];

	// 4. Unknown words before a colon (`https`, `redis`) are plain data, not a cast flag
	if (isIn(castPrefix, ENV_TYPES) === false) return null;

	return castPrefix;
};
