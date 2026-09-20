import { useEnv } from '@novastarter/env';
import { toArray } from '@novastarter/utils';
import { DEFAULT_REDIS_LOCATION } from '../constants/locations.js';

/**
 * Return the names of the additional locations declared in `REDIS_LOCATIONS`.
 *
 * The default location is not part of the list, it always exists. The list is what tells the default client which
 * `REDIS_<NAME>_*` families to skip when it collects its own `REDIS_*` options, so a location that is not declared
 * here leaks its variables into the default client.
 *
 * @returns The declared names, trimmed, without the default one and without duplicates; empty when unset.
 * @example
 * ```ts
 * // REDIS_LOCATIONS=queue, sessions
 * getRedisLocations(); // ['queue', 'sessions']
 * ```
 */
export const getRedisLocations = (): string[] => {
	const env = useEnv();
	const declared = env['REDIS_LOCATIONS'];

	// 1. Unset means a single-server setup
	if (declared === undefined || declared === null || declared === '') {
		return [];
	}

	// 2. The variable arrives as an array when it holds a comma, as a plain string for a single name; `toArray` covers
	//    both, and the names are tidied because `a, b` is a natural way to write the list
	const names = toArray(declared as string | string[])
		.map((name) => String(name).trim())
		.filter((name) => name !== '' && name !== DEFAULT_REDIS_LOCATION);

	return [...new Set(names)];
};
