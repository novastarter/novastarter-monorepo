import type { NovastarterError } from '@novastarter/types';

/**
 * Class returned by {@link createError}: a constructor producing a {@link NovastarterError} for one error code.
 *
 * @typeParam Extensions - Details every instance of the error carries.
 */
export interface NovastarterErrorConstructor<Extensions = void> {
	new (extensions: Extensions, options?: ErrorOptions): NovastarterError<Extensions>;
	readonly prototype: NovastarterError<Extensions>;
}

/**
 * Build an error class bound to one code, message and HTTP status.
 *
 * Every error in the codebase is produced through this factory, so all of them share the same shape (`name`, `code`,
 * `status`, `extensions`) and can be told apart from foreign errors with `isNovastarterError`. The message can be
 * a plain string or a function of the extensions, for errors whose text depends on runtime details.
 *
 * @typeParam Extensions - Details the error carries; `void` when the error has none.
 * @param code - Machine-readable identifier; stored upper-cased so matching is case-insensitive.
 * @param message - Human-readable message, or a function building it from the extensions.
 * @param status - HTTP status a transport layer should reply with.
 * @returns A class whose instances are {@link NovastarterError}s with the given code and status.
 * @example
 * ```ts
 * const NotFoundError = createError<{ id: string }>('not_found', ({ id }) => `Item ${id} not found.`, 404);
 *
 * throw new NotFoundError({ id: 'abc' });
 * ```
 */
export const createError = <Extensions = void>(
	code: string,
	message: string | ((extensions: Extensions) => string),
	status = 500,
): NovastarterErrorConstructor<Extensions> => {
	// Subclassing keeps `instanceof Error` and stack traces working, while the fields below give every instance the
	// shared shape
	return class extends Error implements NovastarterError<Extensions> {
		/** Fixed name every error made by this factory shares; the type guard relies on it. */
		override name = 'NovastarterError';

		/** Details specific to this error class. */
		extensions: Extensions;

		/** Upper-cased code, so `code` comparisons do not depend on the caller's casing. */
		code = code.toUpperCase();

		/** HTTP status a transport layer should reply with. */
		status = status;

		/**
		 * Create the error with its details.
		 *
		 * @param extensions - Details the error carries; also fed to the message function when there is one.
		 * @param options - Standard `ErrorOptions`, for example a `cause`.
		 */
		constructor(extensions: Extensions, options?: ErrorOptions) {
			// Resolved before `super`, since a function message needs the extensions to build the text
			const msg = typeof message === 'string' ? message : message(extensions as Extensions);

			super(msg, options);

			// Consumers read the details after catching
			this.extensions = extensions;
		}

		/**
		 * Render the error as `NovastarterError [CODE]: message`, so logs show the code without extra formatting.
		 *
		 * @returns Single-line representation of the error.
		 */
		override toString(): string {
			// A log reader scans for the code between name and message
			return `${this.name} [${this.code}]: ${this.message}`;
		}
	};
};

/**
 * Re-exported so consumers can type caught errors without depending on `@novastarter/types` directly.
 */
export type { NovastarterError };
