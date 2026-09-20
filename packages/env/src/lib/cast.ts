import { toArray, toBoolean } from '@novastarter/utils';
import { toNumber, toString } from 'lodash-es';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { tryJson } from '../utils/try-json.js';

/**
 * Apply the cast prefix of a raw configuration value, when it carries one.
 *
 * Only an explicit prefix converts: `number:1` becomes `1`, `boolean:true` becomes `true`, `array:a,b` becomes
 * `['a', 'b']` with its members cast one by one (`array:string:a,number:1` yields `['a', 1]`). A value without a
 * prefix is returned as it is — a string from the environment, whatever type a config file gave it — and the
 * application's schema decides what it becomes. Nothing is guessed from the look of a value, so `0123` and `true`
 * stay strings until a schema says otherwise.
 *
 * @param value - Raw value, possibly carrying a cast prefix.
 * @returns The converted value, or the value untouched.
 * @example
 * ```ts
 * cast('number:8055');
 * // => 8055
 *
 * cast('8055');
 * // => '8055'
 * ```
 */
export const cast = (value: unknown): unknown => {
	// 1. Only an explicit prefix converts; without one the value is the application's to interpret
	const castFlag = getCastFlag(value);

	if (!castFlag) {
		return value;
	}

	// 2. Strip the prefix and its colon, so the remainder is the actual payload
	const payload = typeof value === 'string' ? value.substring(castFlag.length + 1) : value;

	// 3. Apply the conversion. Array members recurse: they carry their own prefixes or stay strings, and empty members
	//    from a trailing comma are dropped
	switch (castFlag) {
		case 'string':
			return toString(payload);
		case 'number':
			return toNumber(payload);
		case 'boolean':
			return toBoolean(payload);
		case 'regex':
			return new RegExp(String(payload));
		case 'array':
			return toArray(payload)
				.map((v) => cast(v))
				.filter((v) => v !== '');
		case 'json':
			return tryJson(payload);
	}
};
