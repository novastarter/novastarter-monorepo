/**
 * Tests of `types/filter`.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { ClientFilterOperator, FieldFilter, Filter, FilterOperator } from './filter.js';
import * as filter from './filter.js';

test('ships no runtime code', () => {
	// A types-only module must compile to an empty module, or every consumer pays for code it never calls
	expect(Object.keys(filter)).toEqual([]);
});

test('ClientFilterOperator is a superset of FilterOperator', () => {
	// Every operator a storage layer evaluates must also be accepted from a client, or a rule could be stored but
	// never sent
	expectTypeOf<FilterOperator>().toExtend<ClientFilterOperator>();
	expectTypeOf<ClientFilterOperator>().not.toExtend<FilterOperator>();
});

test('Filter accepts logical groups and field rules', () => {
	// Both shapes are one type, so a consumer can nest groups inside groups without a cast
	expectTypeOf<{ _and: Filter[] }>().toExtend<Filter>();
	expectTypeOf<{ age: { _gte: number } }>().toExtend<Filter>();
});

test('FieldFilter reaches into nested objects and takes validation-only operators', () => {
	const nested: FieldFilter = { author: { name: { _eq: 'Ada' } } };

	// Validation-only operators sit next to the ones a storage layer evaluates
	const validating: FieldFilter = { code: { _submitted: true } };

	expect(nested['author']).toBeTypeOf('object');
	expect(validating['code']).toStrictEqual({ _submitted: true });
});
