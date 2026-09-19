import { ErrorCode } from './codes.js';
import type { HitRateLimitErrorExtensions } from './errors/hit-rate-limit.js';

/**
 * Extensions of the error classes that carry details, keyed by their code.
 *
 * Codes missing here belong to errors without extensions.
 */
type Map = {
	[ErrorCode.RequestsExceeded]: HitRateLimitErrorExtensions;
};

/**
 * Map every {@link ErrorCode} to its extensions type, `never` for codes without extensions.
 *
 * Used by `isNovastarterError` to narrow the extensions when a code is passed to the guard.
 */
export type ExtensionsMap = {
	[code in ErrorCode]: code extends keyof Map ? Map[code] : never;
};
