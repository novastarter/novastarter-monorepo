/**
 * Ready-made error classes, one module per code.
 */
export { HitRateLimitError, type HitRateLimitErrorExtensions } from './hit-rate-limit.js';
export { InvalidConfigError, type InvalidConfigErrorExtensions, invalidConfigMessage } from './invalid-config.js';
export { InvalidCredentialsError } from './invalid-credentials.js';
export { InvalidPayloadError, type InvalidPayloadErrorExtensions } from './invalid-payload.js';
export {
	MAX_RETRY_AFTER,
	PROVIDER_CALL_MESSAGE_LIMIT,
	ProviderCallError,
	type ProviderCallErrorExtensions,
	type ProviderCallHeaders,
	providerCallMessage,
	providerErrorReason,
	toProviderCallError,
	type ToProviderCallErrorOptions,
} from './provider-call.js';
