/**
 * Shape shared by every error produced through `createError` in `@novastarter/errors`.
 *
 * Besides the standard `Error` members, an error carries a machine-readable `code`, the HTTP `status` a transport
 * layer should answer with and typed `extensions` holding the details specific to that error (for example the
 * limit and reset time of a rate-limit error).
 *
 * @typeParam Extensions - Details attached to the error, `void` when the error carries none.
 */
export interface NovastarterError<Extensions = void> extends Error {
	/** Error-specific details, typed per error class. */
	extensions: Extensions;
	/** Upper-case machine-readable identifier, for example `REQUESTS_EXCEEDED`. */
	code: string;
	/** HTTP status code a transport layer should reply with. */
	status: number;
}
