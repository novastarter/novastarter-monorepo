/**
 * Convert a configuration value to a finite number, or to `undefined` when it is not one.
 *
 * A finite number passes through; a string is trimmed and parsed with `Number()`, so `'8055'`, `' 1.5 '` and
 * `'0x10'` convert. Everything else — an empty or non-numeric string, `NaN`, `Infinity`, a boolean, `null`, an
 * object — yields `undefined` rather than `NaN`, so a schema or a `??` default sees "no value" instead of a number
 * that fails every comparison silently.
 *
 * @param value - Raw value from the environment or a config file.
 * @returns The number, or `undefined` when `value` holds no finite number.
 * @example
 * ```ts
 * toNumber('8055');
 * // => 8055
 *
 * toNumber('abc');
 * // => undefined
 * ```
 */
export const toNumber = (value: unknown): number | undefined => {
	// 1. A number is answered with as it is, unless it is one of the non-finite values that break arithmetic
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : undefined;
	}

	// 2. Only strings are parsed: `Number(true)` and `Number(null)` give `1` and `0`, which is never what a config
	//    value meant
	if (typeof value !== 'string') {
		return undefined;
	}

	// 3. An empty or blank string would parse to `0`; treat it as absent instead
	const trimmed = value.trim();

	if (trimmed === '') {
		return undefined;
	}

	// 4. `Number()` rejects trailing garbage (`'12px'` → `NaN`) where `parseInt` would not, which is the strictness
	//    a config value wants
	const parsed = Number(trimmed);

	return Number.isFinite(parsed) ? parsed : undefined;
};
