/**
 * Return the input object with every missing optional key filled in from a defaults object.
 *
 * Only keys that are optional in `T` may (and must) be supplied in `def`; required keys are already guaranteed by
 * the input. Keys explicitly set to `undefined` count as missing, so an options object built from possibly-unset
 * environment values still receives the default instead of an `undefined` hole.
 *
 * @typeParam T - Shape of the options object, with the optional keys the defaults cover.
 * @param obj - Caller-provided options; wins over `def` for every key it defines.
 * @param def - Value for each optional key of `T`.
 * @returns A new object with all keys of `T` present.
 * @example
 * ```ts
 * type Example = {
 * 	optional?: boolean;
 * 	required: boolean;
 * };
 *
 * const input: Example = { required: true };
 * const output = defaults(input, { optional: false });
 * // => { required: true, optional: false }
 * ```
 */
export const defaults = <T extends object>(
	obj: T,
	def: Required<
		Pick<
			T,
			Exclude<
				keyof T,
				Exclude<{ [K in keyof T]: T[K] extends Exclude<T[keyof T], undefined> ? K : never }[keyof T], undefined>
			>
		>
	>,
): Required<T> => {
	// 1. Drop keys set to `undefined`, otherwise the spread below would let them override a real default
	const input = Object.fromEntries(Object.entries(obj).filter(([_key, value]) => value !== undefined));

	// 2. Spread the defaults first so any key the caller did define takes precedence
	return {
		...def,
		...input,
	} as Required<T>;
};
