/**
 * Machine-readable codes of the errors this package ships.
 *
 * The string values are what {@link createError} stores in `code`, so the enum doubles as the list a consumer can
 * match against in `isNovastarterError(error, code)`.
 */
export enum ErrorCode {
	/** Credentials did not verify; see `InvalidCredentialsError`. */
	InvalidCredentials = 'INVALID_CREDENTIALS',
	/** A payload failed a check; see `InvalidPayloadError`. */
	InvalidPayload = 'INVALID_PAYLOAD',
	/** A provider refused a driver's `call()`; see `ProviderCallError`. */
	ProviderCallFailed = 'PROVIDER_CALL_FAILED',
	/** A rate limit was hit; see `HitRateLimitError`. */
	RequestsExceeded = 'REQUESTS_EXCEEDED',
}
