/**
 * Tests of `errors/types`.
 */
import { expectTypeOf, test } from 'vitest';
import { ErrorCode } from './codes.js';
import type { HitRateLimitErrorExtensions } from './errors/hit-rate-limit.js';
import type { InvalidPayloadErrorExtensions } from './errors/invalid-payload.js';
import type { ExtensionsMap } from './types.js';

test('Maps codes with extensions to their extensions type', () => {
	// 1. The map is what `isNovastarterError` narrows by when a code is passed; an entry missing here would narrow
	//    the extensions to `never` and reading a field would fail to compile
	expectTypeOf<ExtensionsMap[ErrorCode.InvalidPayload]>().toEqualTypeOf<InvalidPayloadErrorExtensions>();
	expectTypeOf<ExtensionsMap[ErrorCode.RequestsExceeded]>().toEqualTypeOf<HitRateLimitErrorExtensions>();
});

test('Maps codes without extensions to never', () => {
	// 1. An error without extensions must not let a caller read extension fields, so its entry stays `never`
	expectTypeOf<ExtensionsMap[ErrorCode.InvalidCredentials]>().toEqualTypeOf<never>();
});
