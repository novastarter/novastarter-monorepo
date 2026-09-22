/**
 * Tests of `validation/utils/joi-to-error-extensions`.
 */
import type { ValidationErrorItem } from 'joi';
import { describe, expect, test } from 'vitest';
import { joiValidationErrorItemToErrorExtensions } from './joi-to-error-extensions.js';

/**
 * Build a Joi detail with the given rule name and context, since the message is irrelevant to the mapping.
 *
 * @param type - Joi rule name such as `number.greater`.
 * @param context - Rule context Joi would attach.
 * @param path - Path of the value, `['field']` by default.
 * @returns A detail shaped like one entry of `ValidationError.details`.
 */
const item = (type: string, context: Record<string, unknown>, path: (string | number)[] = ['field']) =>
	({ message: '', path, type, context }) as unknown as ValidationErrorItem;

describe('field and path', () => {
	test('first path segment becomes the field, the rest the path', () => {
		// 1. Joi's path starts at the payload root, so the first key is the field and the rest points into it
		const result = joiValidationErrorItemToErrorExtensions(item('any.required', {}, ['user', 'address', 0]));

		expect(result).toStrictEqual({ field: 'user', path: ['address', 0], type: 'required' });
	});

	test('prepends the given parent path', () => {
		// 1. A caller validating a nested object separately passes where it sits, so the path stays absolute
		const result = joiValidationErrorItemToErrorExtensions(item('any.required', {}, ['city']), ['address']);

		expect(result).toStrictEqual({ field: 'city', path: ['address'], type: 'required' });
	});
});

describe('any.only', () => {
	test('maps a single value to eq', () => {
		// 1. One allowed value is an equality, reported with the scalar
		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: ['a'] }))).toMatchObject({
			type: 'eq',
			valid: 'a',
		});
	});

	test('maps several values to in', () => {
		// 1. A list of allowed values is `_in`, reported with the whole list
		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: ['a', 'b'] }))).toMatchObject({
			type: 'in',
			valid: ['a', 'b'],
		});
	});

	test('maps a number and its string twin to eq with the first entry', () => {
		// 1. `generateJoi` builds `_eq: 18` as `[18, '18']`; that is still one value, in the caller's form
		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: [18, '18'] }))).toMatchObject({
			type: 'eq',
			valid: 18,
		});

		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: ['18', 18] }))).toMatchObject({
			type: 'eq',
			valid: '18',
		});

		// 2. Only numbers get a twin, so `true` next to `'true'` is still a list of two
		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: [true, 'true'] })).type).toBe('in');
	});

	test('maps null to null and empty string to empty', () => {
		// 1. The `_null` / `_empty` operators are allow lists with a single entry, told apart by the entry itself
		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: [null] })).type).toBe('null');
		expect(joiValidationErrorItemToErrorExtensions(item('any.only', { valids: [''] })).type).toBe('empty');
	});
});

describe('any.invalid', () => {
	test('maps a single value to neq', () => {
		// 1. One forbidden value is an inequality, reported with the scalar
		expect(joiValidationErrorItemToErrorExtensions(item('any.invalid', { invalids: ['a'] }))).toMatchObject({
			type: 'neq',
			invalid: 'a',
		});
	});

	test('maps several values to nin', () => {
		// 1. A list of forbidden values is `_nin`, reported with the whole list
		expect(joiValidationErrorItemToErrorExtensions(item('any.invalid', { invalids: ['a', 'b'] }))).toMatchObject({
			type: 'nin',
			invalid: ['a', 'b'],
		});
	});

	test('maps a number and its string twin to neq with the first entry', () => {
		// 1. `generateJoi` builds `_neq: 18` as `[18, '18']`; that is still one forbidden value
		expect(joiValidationErrorItemToErrorExtensions(item('any.invalid', { invalids: [18, '18'] }))).toMatchObject({
			type: 'neq',
			invalid: 18,
		});
	});

	test('maps null to nnull and empty string to nempty', () => {
		// 1. The `_nnull` / `_nempty` operators are deny lists with a single entry, told apart by the entry itself
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
		// 1. The rule is matched on its suffix, so number and date bounds share one mapping and the bound is `limit`
		expect(joiValidationErrorItemToErrorExtensions(item(joiType, { limit: 18 }))).toMatchObject({ type, valid: 18 });
	});
});

describe('substrings', () => {
	test('maps contains, icontains and ncontains with the substring', () => {
		// 1. The extended Joi puts the substring into the context, so it is passed through as is
		expect(joiValidationErrorItemToErrorExtensions(item('string.contains', { substring: 'x' }))).toMatchObject({
			type: 'contains',
			substring: 'x',
		});

		// 2. `icontains` ends with `contains`; the whole rule name is compared, so it keeps its own operator
		expect(joiValidationErrorItemToErrorExtensions(item('string.icontains', { substring: 'x' }))).toMatchObject({
			type: 'icontains',
			substring: 'x',
		});

		// 3. `ncontains` ends with `contains` too and must not be swallowed by the contains branch
		expect(joiValidationErrorItemToErrorExtensions(item('string.ncontains', { substring: 'x' }))).toMatchObject({
			type: 'ncontains',
			substring: 'x',
		});
	});

	test.each([
		'starts_with',
		'nstarts_with',
		'istarts_with',
		'nistarts_with',
		'ends_with',
		'nends_with',
		'iends_with',
		'niends_with',
	])('maps string.%s to the operator with the original substring', (rule) => {
		// 1. The rule name is the operator; the substring comes from the context untouched, so metacharacters and
		//    slashes are reported as the caller wrote them rather than regex-escaped
		const result = joiValidationErrorItemToErrorExtensions(item(`string.${rule}`, { substring: 'http://a.b/$' }));

		expect(result).toStrictEqual({ field: 'field', path: [], type: rule, substring: 'http://a.b/$' });
	});

	test('does not mistake a named pattern for a prefix rule', () => {
		// 1. Hand-built named patterns are no longer reverse-engineered; they are unknown like any other rule
		expect(() =>
			joiValidationErrorItemToErrorExtensions(item('string.pattern.name', { name: 'starts_with', regex: /^a.*/ })),
		).toThrowError("Couldn't extract validation error type from Joi validation error item");
	});
});

describe('other rules', () => {
	test('maps a bare pattern to regex with the rejected value', () => {
		// 1. The pattern itself is not reported, only the value, since the client renders "wrong format"
		expect(joiValidationErrorItemToErrorExtensions(item('string.pattern.base', { value: 'nope' }))).toMatchObject({
			type: 'regex',
			invalid: 'nope',
		});
	});

	test('maps a wrong base type to required', () => {
		// 1. A value of the wrong type is as unusable as a missing one, so both read as `required`
		expect(joiValidationErrorItemToErrorExtensions(item('number.base', {})).type).toBe('required');
	});

	test('maps a value matching no alternative type to required', () => {
		// 1. The substring rules are string-or-array alternatives; failing both by type is a wrong base type
		expect(
			joiValidationErrorItemToErrorExtensions(item('alternatives.types', { types: ['string', 'array'] })).type,
		).toBe('required');
	});

	test('maps an empty string rejected by a stock string schema to nempty', () => {
		// 1. A caller's own `Joi.string()` rejects `''` before any rule; that is "must not be empty" to the client and
		//    must not escape as a throw
		expect(joiValidationErrorItemToErrorExtensions(item('string.empty', { value: '' }))).toStrictEqual({
			field: 'field',
			path: [],
			type: 'nempty',
		});
	});

	test('maps the array forms of contains and ncontains', () => {
		// 1. Joi reports the array rules without the substring, so only the operator can be given back
		expect(
			joiValidationErrorItemToErrorExtensions(item('array.includesRequiredUnknowns', { unknownMisses: 1 })),
		).toStrictEqual({
			field: 'field',
			path: [],
			type: 'contains',
		});

		// 2. The forbidden item is reported at its index, which lands in the path
		expect(joiValidationErrorItemToErrorExtensions(item('array.excludes', { pos: 1 }, ['field', 1]))).toStrictEqual({
			field: 'field',
			path: [1],
			type: 'ncontains',
		});
	});

	test('maps number.unsafe and number.infinity to unsafe', () => {
		// 1. Neither an out-of-range nor an infinite number is one the client can act on; both read as `unsafe`
		expect(joiValidationErrorItemToErrorExtensions(item('number.unsafe', {})).type).toBe('unsafe');
		expect(joiValidationErrorItemToErrorExtensions(item('number.infinity', { value: Infinity })).type).toBe('unsafe');
	});

	test('throws on a rule it cannot describe', () => {
		// 1. An unknown rule must fail loudly rather than produce an error without a type
		expect(() => joiValidationErrorItemToErrorExtensions(item('array.unique', {}))).toThrowError(
			"Couldn't extract validation error type from Joi validation error item",
		);
	});
});
