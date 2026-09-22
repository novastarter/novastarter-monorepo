/**
 * Tests of `types/filter`.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { ClientFilterOperator, FieldFilter, Filter, FilterOperator } from './filter.js';
import * as filter from './filter.js';

test('ships no runtime code', () => {
	// 1. A types-only module must compile to an empty module, or every consumer pays for code it never calls
	expect(Object.keys(filter)).toEqual([]);
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

test('FieldFilter reaches into nested objects and takes validation-only operators', () => {
	// 1. A rule may nest another filter to check a nested field
	const nested: FieldFilter = { author: { name: { _eq: 'Ada' } } };

	// 2. The value of a rule may also be a validation-only operator, next to the ones a storage layer evaluates
	const validating: FieldFilter = { code: { _submitted: true } };

	expect(nested['author']).toBeTypeOf('object');
	expect(validating['code']).toStrictEqual({ _submitted: true });
});
