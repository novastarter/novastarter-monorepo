/**
 * Tests of `env/constants/env-types`.
 */
import { expect, expectTypeOf, test } from 'vitest';
import { ENV_TYPES } from './env-types.js';

test('Lists every cast flag the package reads', () => {
	// The list is the contract: a value prefixed with one of these is coerced, anything else before a colon is
	// plain data
	expect(ENV_TYPES).toStrictEqual(['string', 'number', 'regex', 'array', 'json', 'boolean']);
});

test('Is a readonly tuple of the literal flags', () => {
	// `as const` keeps the element type to the six literals, which is what `getCastFlag` promises its callers; a
	// widening to `string[]` would let any string through the type
	expectTypeOf(ENV_TYPES).toEqualTypeOf<readonly ['string', 'number', 'regex', 'array', 'json', 'boolean']>();
});
