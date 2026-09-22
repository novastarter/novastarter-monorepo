import type { NovastarterError } from './create-error.js';
import type { ExtensionsMap } from './types.js';

/**
 * Check whether a value is an error made by `createError`, optionally with a specific code.
 *
 * The check is structural (`name === 'NovastarterError'`) instead of `instanceof`, because every `createError` call
 * yields its own class and the error may have been created by another copy of this package.
 *
 * @typeParam T - Extensions type to narrow to when it cannot be derived from `code`; pass it for codes outside
 * {@link ExtensionsMap}, otherwise the extensions stay `unknown`.
 * @typeParam C - Code being checked, used to look the extensions up in {@link ExtensionsMap}.
 * @param value - Any value.
 * @param code - Error code to require, compared case-insensitively.
 * @returns `true` when `value` is a Novastarter error (with the given code, when one is passed).
 * @example
 * ```ts
 * if (isNovastarterError(error, ErrorCode.RequestsExceeded)) {
 *     error.extensions.reset; // typed as Date
 * }
 *
 * if (isNovastarterError<{ thing: string }>(error, 'INVALID_THING')) {
 *     error.extensions.thing; // typed as string
 * }
 * ```
 */
export const isNovastarterError = <T = never, C extends string = string>(
	value: unknown,
	code?: C,
): value is NovastarterError<
	[T] extends [never] ? (C extends keyof ExtensionsMap ? ExtensionsMap[C] : unknown) : T
> => {
	// 1. Only a non-array object carrying the shared name qualifies; arrays are objects too, hence the extra check
	const isNovastarterError =
		typeof value === 'object' &&
		value !== null &&
		Array.isArray(value) === false &&
		'name' in value &&
		value.name === 'NovastarterError';

	// 2. When a code is requested, compare it upper-cased, the way `createError` stores it
	if (code) {
		return isNovastarterError && 'code' in value && value.code === code.toUpperCase();
	}

	// 3. Without a code any Novastarter error matches
	return isNovastarterError;
};
