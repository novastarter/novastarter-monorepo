import type { ValidationErrorItem } from 'joi';
import { describe, expect, test } from 'vitest';
import { joiValidationErrorItemToErrorExtensions } from './joi-to-error-extensions.js';

/**
 * Build a Joi detail with the given rule name and context, since the message is irrelevant to the mapping.
 */
const item = (type: string, context: Record<string, unknown>, path: (string | number)[] = ['field']) =>
	({ message: '', path, type, context }) as unknown as ValidationErrorItem;

describe('field and path', () => {
	test('first path segment becomes the field, the rest the path', () => {
		const result = joiValidationErrorItemToErrorExtensions(item('any.required', {}, ['user', 'address', 0]));
		expect(result).toStrictEqual({ field: 'user', path: ['address', 0], type: 'required' });
	});

	test('prepends the given parent path', () => {
		const result = joiValidationErrorItemToErrorExtensions(item('any.required', {}, ['city']), ['address']);
		expect(result).toStrictEqual({ field: 'city', path: ['address'], type: 'required' });
	});
});

describe('any.only', () => {
	test('maps a single value to eq', () => {
		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: ['a'] }))).toMatchObject({
			type: 'eq',
			valid: 'a',
		});
	});

	test('maps several values to in', () => {
		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: ['a', 'b'] }))).toMatchObject({
			type: 'in',
			valid: ['a', 'b'],
		});
	});

	test('maps null to null and empty string to empty', () => {
		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: [null] })).type).toBe('null');
		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: [''] })).type).toBe('empty');
	});
});

describe('any.invalid', () => {
	test('maps a single value to neq', () => {
		expect(joiValidationErrorItemToErrorExtensions(item('any.invalid', { invalids: ['a'] }))).toMatchObject({
			type: 'neq',
			invalid: 'a',
		});
	});

	test('maps several values to nin', () => {
		expect(joiValidationErrorItemToErrorExtensions(item('any.invalid', { invalids: ['a', 'b'] }))).toMatchObject({
			type: 'nin',
			invalid: ['a', 'b'],
		});
	});

	test('maps null to nnull and empty string to nempty', () => {
		expect(joiValidationErrorItemToErrorExtensions(item('any.invalid', { invalids: [null] })).type).toBe('nnull');
		expect(joiValidationErrorItemToErrorExtensions(item('any.invalid', { invalids: [''] })).type).toBe('nempty');
	});
});

describe('ranges', () => {
	test.each([
		['number.greater', 'gt'],
		['number.min', 'gte'],
		['number.less', 'lt'],
		['number.max', 'lte'],
		['date.greater', 'gt'],
		['date.min', 'gte'],
	])('maps %s to %s with the limit', (joiType, type) => {
		expect(joiValidationErrorItemToErrorExtensions(item(joiType, { limit: 18 }))).toMatchObject({ type, valid: 18 });
	});
});

describe('substrings', () => {
	test('maps contains and ncontains with the substring', () => {
		expect(joiValidationErrorItemToErrorExtensions(item('string.contains', { substring: 'x' }))).toMatchObject({
			type: 'contains',
			substring: 'x',
		});

		expect(joiValidationErrorItemToErrorExtensions(item('string.ncontains', { substring: 'x' }))).toMatchObject({
			type: 'ncontains',
			substring: 'x',
		});
	});

	test('cuts the substring back out of a named starts_with pattern', () => {
		const result = joiValidationErrorItemToErrorExtensions(
			item('string.pattern.name', { name: 'starts_with', regex: /^abc.*/ }),
		);

		expect(result).toMatchObject({ type: 'starts_with', substring: 'abc' });
	});

	test('cuts the substring back out of an inverted, case-insensitive ends_with pattern', () => {
		const result = joiValidationErrorItemToErrorExtensions(
			item('string.pattern.invert.name', { name: 'niends_with', regex: /.*abc$/i }),
		);

		expect(result).toMatchObject({ type: 'niends_with', substring: 'abc' });
	});
});

describe('other rules', () => {
	test('maps a bare pattern to regex with the rejected value', () => {
		expect(joiValidationErrorItemToErrorExtensions(item('string.pattern.base', { value: 'nope' }))).toMatchObject({
			type: 'regex',
			invalid: 'nope',
		});
	});

	test('maps a wrong base type to required', () => {
		expect(joiValidationErrorItemToErrorExtensions(item('number.base', {})).type).toBe('required');
	});

	test('maps a value matching no alternative type to required', () => {
		expect(
			joiValidationErrorItemToErrorExtensions(item('alternatives.types', { types: ['string', 'array'] })).type,
		).toBe('required');
	});

	test('maps the array forms of contains and ncontains', () => {
		expect(
			joiValidationErrorItemToErrorExtensions(item('array.includesRequiredUnknowns', { unknownMisses: 1 })),
		).toStrictEqual({
			field: 'field',
			path: [],
			type: 'contains',
		});

		expect(joiValidationErrorItemToErrorExtensions(item('array.excludes', { pos: 1 }, ['field', 1]))).toStrictEqual({
			field: 'field',
			path: [1],
			type: 'ncontains',
		});
	});

	test('maps number.unsafe to unsafe', () => {
		expect(joiValidationErrorItemToErrorExtensions(item('number.unsafe', {})).type).toBe('unsafe');
	});

	test('throws on a rule it cannot describe', () => {
		expect(() => joiValidationErrorItemToErrorExtensions(item('array.unique', {}))).toThrowError(
			"Couldn't extract validation error type from Joi validation error item",
		);
	});
});
