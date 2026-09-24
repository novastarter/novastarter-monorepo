/**
 * Whether a value carries every named method, narrowing it to the type that declares them.
 *
 * Duck typing for a value that may be an instance of a class from another copy of a library — a connection pool an
 * application built with its own `pg`, a client from a different version of an SDK — where `instanceof` fails although
 * the object is what it claims. The methods a caller names are the ones it will call, so the check is as strict as the
 * use and no stricter.
 *
 * @typeParam T - The type the value is narrowed to; its keys are what `methods` may name.
 * @param value - Whatever an option or a payload delivered.
 * @param methods - Names of the methods every value of `T` has, and the caller relies on.
 * @returns `true` when `value` is an object or a function with every method callable.
 * @example
 * ```ts
 * const pool = hasMethods<Pool>(connection, ['connect', 'end']) ? connection : new Pool(connection);
 * ```
 */
export const hasMethods = <T extends object>(value: unknown, methods: readonly (keyof T & string)[]): value is T => {
	// `typeof null` is `'object'`, hence the extra check.
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
		return false;
	}

	// Every member must be callable: a bare options object may carry data under these names.
	return methods.every((method) => typeof (value as Record<string, unknown>)[method] === 'function');
};
