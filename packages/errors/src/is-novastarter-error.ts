import type { NovastarterError } from './create-error.js';
import type { ExtensionsMap } from './types.js';

/**
 * Check whether a value is an error made by `createError`, optionally with a specific code.
 *
 * The check is structural (`name === 'NovastarterError'`) instead of `instanceof`, because every `createError` call
 * yields its own class and the error may have been created by another copy of this package.
 *
 * The guard never throws: it is meant for values caught as `unknown`, and a hostile value such as a revoked Proxy
 * throws on every structural probe (`Array.isArray`, `in`, property reads), so anything that throws while being
 * probed is reported as `false` instead.
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
	// A hostile object such as a revoked Proxy throws on every structural probe (`Array.isArray`, `in`, property
	// reads), and a guard applied to caught `unknown` values must be total — anything that throws while being probed is
	// simply not a match
	try {
		// Arrays are objects too, hence the extra check. The local is named `matches` rather than after the exported
		// function, so the two never shadow each other
		const matches =
			typeof value === 'object' &&
			value !== null &&
			Array.isArray(value) === false &&
			'name' in value &&
			value.name === 'NovastarterError';

		// Upper-cased, the way `createError` stores the code
		if (code) {
			return matches && 'code' in value && value.code === code.toUpperCase();
		}

		return matches;
	} catch {
		// A value that fights the probe cannot be a Novastarter error, and the guard must not throw
		return false;
	}
};
