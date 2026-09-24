/**
 * Tests of `types/index`: the single import path the package exposes.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { ClientFilterOperator, EventContext, Filter, FilterOperator, NovastarterError } from './index.js';
import * as types from './index.js';

test('ships no runtime code', () => {
	// A types-only package must compile to an empty module, or every consumer pays for code it never calls
	expect(Object.keys(types)).toEqual([]);
});

test('re-exports every subsystem', () => {
	// The package root is the one import path a consumer uses; the types of each submodule must stay reachable
	// through it as the submodules themselves define them
	expectTypeOf<NovastarterError>().toEqualTypeOf<import('./error.js').NovastarterError>();
	expectTypeOf<Filter>().toEqualTypeOf<import('./filter.js').Filter>();
	expectTypeOf<FilterOperator>().toEqualTypeOf<import('./filter.js').FilterOperator>();
	expectTypeOf<ClientFilterOperator>().toEqualTypeOf<import('./filter.js').ClientFilterOperator>();
	expectTypeOf<EventContext>().toEqualTypeOf<import('./events.js').EventContext>();
});
