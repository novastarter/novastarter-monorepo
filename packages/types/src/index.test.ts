import { expect, expectTypeOf, test } from 'vitest';
import type { ClientFilterOperator, Filter, FilterOperator, NovastarterError } from './index.js';
import * as types from './index.js';

test('ships no runtime code', () => {
	// 1. A types-only package must compile to an empty module, or every consumer pays for code it never calls
	expect(Object.keys(types)).toEqual([]);
});

test('ClientFilterOperator is a superset of FilterOperator', () => {
	// 1. Every operator a storage layer evaluates must also be accepted from a client, or a rule could be stored but
	//    never sent
	expectTypeOf<FilterOperator>().toExtend<ClientFilterOperator>();
	expectTypeOf<ClientFilterOperator>().not.toExtend<FilterOperator>();
});

test('Filter accepts logical groups and field rules', () => {
	// 1. Both shapes are one type, so a consumer can nest groups inside groups without a cast
	expectTypeOf<{ _and: Filter[] }>().toExtend<Filter>();
	expectTypeOf<{ age: { _gte: number } }>().toExtend<Filter>();
});

test('NovastarterError carries typed extensions', () => {
	// 1. The generic is what lets a caller read the details of one error class without narrowing by hand
	expectTypeOf<NovastarterError<{ limit: number }>['extensions']>().toEqualTypeOf<{ limit: number }>();
	expectTypeOf<NovastarterError['extensions']>().toEqualTypeOf<void>();
});
