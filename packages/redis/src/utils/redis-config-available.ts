import { useEnv } from '@novastarter/env';
import { DEFAULT_REDIS_LOCATION, NON_CLIENT_KEYS } from '../constants/locations.js';
import { getRedisLocations } from './get-redis-locations.js';
import { getRedisPrefix } from './get-redis-prefix.js';

/**
 * Tell whether the environment configures a Redis connection for a location.
 *
 * This is the switch the rest of the stack uses to pick `type: 'redis'` over `type: 'local'` for the
 * `@novastarter/memory` factories. An explicit `<PREFIX>_ENABLED` wins; without it, the location counts as
 * configured as soon as its URL or any of its client variables is set, so a deployment does not need an extra flag
 * next to its host. Variables of other locations and the ones meant for other subsystems do not count.
 *
 * @param name - Location name; the default location when omitted.
 * @returns `true` when a client can be built from the environment.
 * @example
 * ```ts
 * const bus = redisConfigAvailable()
 * 	? createBus({ type: 'redis', redis: useRedis(), namespace: 'app' })
 * 	: createBus({ type: 'local' });
 * ```
 */
export const redisConfigAvailable = (name: string = DEFAULT_REDIS_LOCATION): boolean => {
	const env = useEnv();
	const prefix = getRedisPrefix(name);

	// 1. The explicit switch overrides any connection variables, so Redis can be turned off without unsetting them
	if (`${prefix}_ENABLED` in env) {
		return env[`${prefix}_ENABLED`] === true;
	}

	// 2. A URL means somebody meant to connect
	if (prefix in env) {
		return true;
	}

	// 3. So does any split variable, as long as it belongs to this location and not to a sibling family nested under
	//    the same prefix, nor to another subsystem
	const foreign = getRedisLocations()
		.filter((other) => other !== name)
		.map((other) => `${getRedisPrefix(other)}_`);

	return Object.keys(env).some(
		(key) =>
			key.startsWith(`${prefix}_`) &&
			!NON_CLIENT_KEYS.includes(key) &&
			!foreign.some((foreignPrefix) => key.startsWith(foreignPrefix)),
	);
};
