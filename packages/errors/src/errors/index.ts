/**
 * Ready-made error classes, one module per code.
 */
export { HitRateLimitError } from './hit-rate-limit.js';
export { InvalidCredentialsError } from './invalid-credentials.js';
export { InvalidPayloadError, type InvalidPayloadErrorExtensions } from './invalid-payload.js';
export { LimitExceededError, type LimitExceededErrorExtensions } from './limit-exceeded.js';
export { ResourceRestrictedError, type ResourceRestrictedErrorExtensions } from './resource-restricted.js';
