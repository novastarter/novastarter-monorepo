/**
 * Tests of `env/types/env`.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { Env } from './env.js';
import * as envModule from './env.js';

test('Is a plain string-keyed map of unknown values', () => {
	// Every entry is cast to its own type before it lands here, so the map itself cannot promise more than
	// `unknown` and the consumer narrows what it reads
	expectTypeOf<Env>().toEqualTypeOf<Record<string, unknown>>();
});

test('Ships no runtime code', () => {
	// A types-only module must compile to an empty module, or every consumer pays for code it never calls
	expect(Object.keys(envModule)).toEqual([]);
});
