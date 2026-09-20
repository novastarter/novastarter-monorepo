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
	/** A plan's limit would be exceeded; see `LimitExceededError`. */
	LimitExceeded = 'LIMIT_EXCEEDED',
	/** A rate limit was hit; see `HitRateLimitError`. */
	RequestsExceeded = 'REQUESTS_EXCEEDED',
	/** A resource the plan does not grant; see `ResourceRestrictedError`. */
	ResourceRestricted = 'RESOURCE_RESTRICTED',
}
