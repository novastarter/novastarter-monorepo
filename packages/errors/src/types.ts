import { ErrorCode } from './codes.js';
import type { HitRateLimitErrorExtensions } from './errors/hit-rate-limit.js';
import type { InvalidPayloadErrorExtensions } from './errors/invalid-payload.js';
import type { ProviderCallErrorExtensions } from './errors/provider-call.js';

/**
 * Extensions of the error classes that carry details, keyed by their code.
 *
 * Codes missing here belong to errors without extensions. Every new error class with extensions gets an entry,
 * otherwise `isNovastarterError` narrows its extensions to `never` and reading a field fails to compile.
 */
type Map = {
	[ErrorCode.InvalidPayload]: InvalidPayloadErrorExtensions;
	[ErrorCode.RequestsExceeded]: HitRateLimitErrorExtensions;
	[ErrorCode.ProviderCallFailed]: ProviderCallErrorExtensions;
};

/**
 * Map every {@link ErrorCode} to its extensions type, `never` for codes without extensions.
 *
 * Used by `isNovastarterError` to narrow the extensions when a code is passed to the guard.
 */
export type ExtensionsMap = {
	[code in ErrorCode]: code extends keyof Map ? Map[code] : never;
};
