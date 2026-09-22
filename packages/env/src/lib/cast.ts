import { toArray, toBoolean, toNumber, tryParseJSON } from '@novastarter/utils';
import { getCastFlag } from '../utils/has-cast-prefix.js';

/**
 * Apply the cast prefix of a raw configuration value, when it carries one.
 *
 * Only an explicit prefix converts: `number:1` becomes `1`, `boolean:true` becomes `true`, `regex:^a` becomes a
 * `RegExp`, `array:a,b` becomes `['a', 'b']` with its members cast one by one (`array:string:a,number:1` yields
 * `['a', 1]`; an empty member, from a trailing comma, is dropped), `json:` parses the payload and keeps it as it is
 * when it is not JSON. A payload the prefix cannot read — `number:80O0`, `regex:(` — is refused with an error naming
 * the value: the prefix says what the value must be, so a typo is a broken configuration to fix at start-up, not a
 * missing variable a schema default would quietly paper over. A value without a prefix is returned as it is — a
 * string from the environment, whatever type a config file gave it — and the application's schema decides what it
 * becomes. Nothing is guessed from the look of a value, so `0123` and `true` stay strings until a schema says
 * otherwise.
 *
 * @param value - Raw value, possibly carrying a cast prefix.
 * @returns The converted value, or the value untouched.
 * @throws Error when a `number:` payload is not a finite number or a `regex:` payload is not a valid pattern.
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

	// 4. Apply the conversion. A payload the prefix cannot read — `number:` with no number, `regex:` with a broken
	//    pattern — is refused: cast to `undefined`, it would take a schema default and boot the wrong way with
	//    nothing logged, where a typo should stop the start-up and name itself. Array members recurse: they carry
	//    their own prefixes or stay strings, and an empty member (a trailing comma) is dropped. A `json:` payload
	//    that is not JSON — a plain word such as `production` — is kept as the string it is
	switch (castFlag) {
		case 'string':
			return payload;
		case 'number':
			return toCastNumber(value, payload);
		case 'boolean':
			return toBoolean(payload);
		case 'regex':
			return toRegExp(value, payload);
		case 'array':
			return toArray(payload)
				.map((v) => cast(v))
				.filter((v) => v !== '');
		case 'json':
			return tryParseJSON(payload, payload);
	}
};

/**
 * Read a `number:` payload, or refuse it.
 *
 * @param value - The whole value, prefix included, for the message.
 * @param payload - The text after the prefix.
 * @returns The number.
 * @throws Error when the payload is not a finite number.
 * @internal
 */
const toCastNumber = (value: string, payload: string): number => {
	// 1. `toNumber` answers `undefined` for anything that is not a finite number; here that is a broken value
	const number = toNumber(payload);

	if (number === undefined) {
		throw new Error(`Cannot cast "${value}" to a number`);
	}

	return number;
};

/**
 * Compile a `regex:` payload, or refuse it.
 *
 * @param value - The whole value, prefix included, for the message.
 * @param pattern - Source of the regular expression, without delimiters or flags.
 * @returns The compiled expression.
 * @throws Error, with the `SyntaxError` as `cause`, when `pattern` does not compile.
 * @internal
 */
const toRegExp = (value: string, pattern: string): RegExp => {
	// 1. `RegExp` throws a `SyntaxError` on a broken pattern; it is rethrown naming the value, so the log line says
	//    which variable to fix
	try {
		return new RegExp(pattern);
	} catch (error) {
		throw new Error(`Cannot cast "${value}" to a regular expression`, { cause: error });
	}
};
