/**
 * Public entry point of `@novastarter/errors`.
 *
 * The factory, the code catalogue, the type guard and the ready-made error classes are re-exported from one place,
 * so consumers import everything from a single package path.
 */
export { ErrorCode } from './codes.js';
export { createError } from './create-error.js';
export type { NovastarterError, NovastarterErrorConstructor } from './create-error.js';
export {
	HitRateLimitError,
	InvalidConfigError,
	invalidConfigMessage,
	InvalidCredentialsError,
	InvalidPayloadError,
	MAX_RETRY_AFTER,
	PROVIDER_CALL_MESSAGE_LIMIT,
	ProviderCallError,
	providerCallMessage,
	providerErrorReason,
	toProviderCallError,
} from './errors/index.js';
export type {
	HitRateLimitErrorExtensions,
	InvalidConfigErrorExtensions,
	InvalidPayloadErrorExtensions,
	ProviderCallErrorExtensions,
	ProviderCallHeaders,
	ToProviderCallErrorOptions,
} from './errors/index.js';
export { isNovastarterError } from './is-novastarter-error.js';
