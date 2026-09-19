import { toArray, toBoolean } from '@novastarter/utils';
import { toNumber, toString } from 'lodash-es';
import { getDefaultType } from '../utils/get-default-type.js';
import { guessType } from '../utils/guess-type.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { tryJson } from '../utils/try-json.js';

/**
 * Coerce a raw configuration value to its intended type.
 *
 * The type is chosen in this order: an explicit cast prefix on the value (`number:1`), the entry for the variable in
 * the type map, and finally a guess from the value itself. Array members are cast one by one, so
 * `array:string:a,number:1` yields `['a', 1]`.
 *
 * @param value - Raw value, possibly carrying a cast prefix.
 * @param key - Variable name used for the type-map lookup; omitted for array members.
 * @returns The cast value.
 * @example
 * ```ts
 * cast('8055', 'PORT');
 * // => '8055' — PORT is mapped to string
 *
 * cast('8055');
 * // => 8055 — guessed as number
 * ```
 */
export const cast = (value: unknown, key?: string): unknown => {
	// 1. Resolve the type: explicit prefix, then type map, then guess
	const castFlag = getCastFlag(value);

	const type = castFlag ?? getDefaultType(key) ?? guessType(value);

	// 2. Strip the prefix and its colon, so the remainder is the actual payload
	if (typeof value === 'string' && castFlag) {
		value = value.substring(castFlag.length + 1);
	}

	// 3. Apply the conversion. Array members recurse without a key: they carry their own prefixes or get guessed, and
	//    empty members from a trailing comma are dropped
	switch (type) {
		case 'string':
			return toString(value);
		case 'number':
			return toNumber(value);
		case 'boolean':
			return toBoolean(value);
		case 'regex':
			return new RegExp(String(value));
		case 'array':
			return toArray(value)
				.map((v) => cast(v))
				.filter((v) => v !== '');
		case 'json':
			return tryJson(value);
	}
};
