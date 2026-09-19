import { TYPE_MAP_REGEX } from '../constants/type-map.js';
import type { EnvType } from '../types/env-type.js';

/**
 * Look up the type a variable is expected to hold in the type map.
 *
 * @param key - Variable name; `undefined` when a value is cast without a name, as for array members.
 * @returns The mapped type, or `null` when the name has no entry.
 */
export const getDefaultType = (key: string | undefined): EnvType | null => {
	// 1. Nameless values (array elements) have no map entry by definition
	if (!key) return null;

	// 2. First matching pattern wins; entries are anchored regexes so wildcards like `STORAGE_.+_SECRET` work
	const type = TYPE_MAP_REGEX.find(([map_key, _]) => map_key.test(key));

	if (type !== undefined) {
		return type[1];
	}

	// 3. No entry: the caller falls back to guessing from the value
	return null;
};
