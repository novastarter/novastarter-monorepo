import { toArray, toBoolean, toNumber, tryParseJSON } from '@novastarter/utils';
import { getCastFlag } from '../utils/has-cast-prefix.js';

/**
 * Apply the cast prefix of a raw configuration value, when it carries one.
 *
 * Only an explicit prefix converts: `number:1` becomes `1` (`undefined` when the payload is not a finite number),
 * `boolean:true` becomes `true`, `array:a,b` becomes `['a', 'b']` with its members cast one by one
 * (`array:string:a,number:1` yields `['a', 1]`; a member that is empty or casts to `undefined` is dropped), `json:`
 * parses the payload and keeps it as it is when it is not JSON. A value without a prefix is returned as it is — a
 * string from the environment, whatever type a config file gave it — and the application's schema decides what it
 * becomes. Nothing is guessed from the look of a value, so `0123` and `true` stay strings until a schema says
 * otherwise.
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
	// 1. Only a string can carry a prefix: a number or an object from a JS/YAML config is already typed
	if (typeof value !== 'string') {
		return value;
	}

	// 2. Only an explicit prefix converts; without one the value is the application's to interpret
	const castFlag = getCastFlag(value);

	if (!castFlag) {
		return value;
	}

	// 3. Strip the prefix and its colon, so the remainder is the actual payload
	const payload = value.substring(castFlag.length + 1);

	// 4. Apply the conversion. Array members recurse: they carry their own prefixes or stay strings, and a member that
	//    is empty (a trailing comma) or casts to `undefined` (`number:` with no number) is dropped. A `json:` payload
	//    that is not JSON — a plain word such as `production` — is kept as the string it is
	switch (castFlag) {
		case 'string':
			return payload;
		case 'number':
			return toNumber(payload);
		case 'boolean':
			return toBoolean(payload);
		case 'regex':
			return new RegExp(payload);
		case 'array':
			return toArray(payload)
				.map((v) => cast(v))
				.filter((v) => v !== '' && v !== undefined);
		case 'json':
			return tryParseJSON(payload, payload);
	}
};
