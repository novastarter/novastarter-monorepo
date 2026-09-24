/**
 * Tests of `types/error`.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { NovastarterError } from './error.js';
import * as error from './error.js';

test('ships no runtime code', () => {
	// A types-only module must compile to an empty module, or every consumer pays for code it never calls
	expect(Object.keys(error)).toEqual([]);
});

test('NovastarterError carries typed extensions', () => {
	// The generic is what lets a caller read the details of one error class without narrowing by hand
	expectTypeOf<NovastarterError<{ limit: number }>['extensions']>().toEqualTypeOf<{ limit: number }>();
	expectTypeOf<NovastarterError['extensions']>().toEqualTypeOf<void>();
});
