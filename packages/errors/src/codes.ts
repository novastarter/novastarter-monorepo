/**
 * Machine-readable codes of the errors this package ships.
 *
 * The string values are what {@link createError} stores in `code`, so the enum doubles as the list a consumer can
 * match against in `isNovastarterError(error, code)`.
 */
export enum ErrorCode {
	/** A rate limit was hit; see `HitRateLimitError`. */
	RequestsExceeded = 'REQUESTS_EXCEEDED',
}
