/**
 * Tests of `validation/lib/validate-payload`.
 */
import type { Filter } from '@novastarter/types';
import { describe, expect, it, test } from 'vitest';
import { FailedValidationError } from '../errors/failed-validation.js';
import { validatePayload } from './validate-payload.js';

describe('validatePayload', () => {
	it('returns an empty array when there are no errors', () => {
		// A passing payload yields an empty list, not `undefined`, so callers can spread it into a throw
		const mockFilter = { _and: [{ field: { _eq: 'field' } }] } as Filter;

		expect(validatePayload(mockFilter, { field: 'field' })).toStrictEqual([]);
	});

	it('returns an array of 1 when there errors with an _and operator', () => {
		// A single failing member of an `_and` is reported on its own
		const mockFilter = { _and: [{ field: { _eq: 'field' } }] } as Filter;

		expect(validatePayload(mockFilter, { field: 'test' })).toHaveLength(1);
	});

	it('returns an array of 1 when there errors with an _or operator', () => {
		// An `_or` with no passing member surfaces the errors of every member; with one member that is one error
		const mockFilter = { _or: [{ field: { _eq: 'field' } }] } as Filter;

		expect(validatePayload(mockFilter, { field: 'test' })).toHaveLength(1);
	});

	it('returns an array of 1 when there errors with an _or containing _and operators', () => {
		// Nested groups: each `_and` branch needs both fields, the `_or` passes when either branch does
		const mockFilter = {
			_or: [
				{
					_and: [{ a: { _eq: 1 } }, { b: { _eq: 1 } }],
				},
				{
					_and: [{ a: { _eq: 2 } }, { b: { _eq: 2 } }],
				},
			],
		} as Filter;

		// The error count is the sum over the failing branches, so it shrinks as more rules match
		expect(validatePayload(mockFilter, { a: 0, b: 0 })).toHaveLength(4);
		expect(validatePayload(mockFilter, { a: 0, b: 1 })).toHaveLength(3);
		expect(validatePayload(mockFilter, { a: 1, b: 2 })).toHaveLength(2);

		// One passing branch silences the errors of the other
		expect(validatePayload(mockFilter, { a: 1, b: 1 })).toHaveLength(0);
		expect(validatePayload(mockFilter, { a: 2, b: 2 })).toHaveLength(0);
	});

	it('returns an empty array when there is no error for filter field that does not exist in payload ', () => {
		// An empty payload stands in for a field the client never sent, which passes without `requireAll` so a
		// partial update is not rejected for what it leaves out
		const mockFilter = { field: { _eq: 'field' } } as Filter;

		expect(validatePayload(mockFilter, {})).toHaveLength(0);
	});

	it('returns an array of 1 when there is required error for filter field that does not exist in payload and requireAll option flag is true', () => {
		// An empty payload stands in for a field the client never sent, which must fail with `requireAll`
		const mockFilter = { field: { _eq: 'field' } } as Filter;

		const errors = validatePayload(mockFilter, {}, { requireAll: true });

		// The missing field is reported as `required`, with the package's error class and message
		expect(errors).toHaveLength(1);
		expect(errors[0]).toBeInstanceOf(FailedValidationError);
		expect(errors[0]!.message).toBe('Validation failed for field "field". Value is required.');
		expect(errors[0]!.extensions).toStrictEqual({ field: 'field', path: [], type: 'required' });
	});

	it('returns one error per failed rule with the field, the rule and the compared value in extensions', () => {
		// Two failing members of an `_and`, each of a different rule family, to see both shapes side by side
		const mockFilter = { _and: [{ age: { _gte: 18 } }, { email: { _contains: '@' } }] } as Filter;

		const errors = validatePayload(mockFilter, { age: 3, email: 'nope' });

		// Every error carries the code and status a transport layer maps to a 400, plus the structured extensions
		expect(errors).toHaveLength(2);
		expect(errors[0]!.code).toBe('FAILED_VALIDATION');
		expect(errors[0]!.status).toBe(400);
		expect(errors[0]!.extensions).toStrictEqual({ field: 'age', path: [], type: 'gte', valid: 18 });
		expect(errors[1]!.extensions).toStrictEqual({ field: 'email', path: [], type: 'contains', substring: '@' });
	});

	it('reports the path below the field for a nested filter', () => {
		// The top-level key is the field, the keys below it land in `path`, so a client can point at the input
		const mockFilter = { author: { name: { _eq: 'Ada' } } } as Filter;

		const errors = validatePayload(mockFilter, { author: { name: 'Bob' } });

		expect(errors).toHaveLength(1);
		expect(errors[0]!.extensions).toStrictEqual({ field: 'author', path: ['name'], type: 'eq', valid: 'Ada' });
	});

	it('reports _eq and _neq with a numeric value as eq and neq with the scalar', () => {
		// `_eq: 18` is built as `18` plus its string twin; the twin must not turn the rule into an `in` of two
		// identical values, since a client renders `valid` as the one value the field had to be
		const eqErrors = validatePayload({ age: { _eq: 18 } }, { age: 3 });

		expect(eqErrors).toHaveLength(1);
		expect(eqErrors[0]!.extensions).toStrictEqual({ field: 'age', path: [], type: 'eq', valid: 18 });
		expect(eqErrors[0]!.message).toBe('Validation failed for field "age". Value has to be "18".');

		// A numeric string keeps the caller's form as `valid`
		expect(validatePayload({ age: { _eq: '18' } }, { age: 3 })[0]!.extensions).toStrictEqual({
			field: 'age',
			path: [],
			type: 'eq',
			valid: '18',
		});

		// `_neq` mirrors it: the twin form of the value is rejected and reported as the one forbidden value
		const neqErrors = validatePayload({ age: { _neq: 18 } }, { age: '18' });

		expect(neqErrors).toHaveLength(1);
		expect(neqErrors[0]!.extensions).toStrictEqual({ field: 'age', path: [], type: 'neq', invalid: 18 });
		expect(neqErrors[0]!.message).toBe('Validation failed for field "age". Value can\'t be "18".');
	});

	it('reports the original substring for the starts_with and ends_with families', () => {
		// Values with regex metacharacters and slashes: the substring must come back as typed, not escaped
		expect(validatePayload({ url: { _starts_with: 'http://' } }, { url: 'ftp://x' })[0]!.extensions).toStrictEqual({
			field: 'url',
			path: [],
			type: 'starts_with',
			substring: 'http://',
		});

		expect(validatePayload({ v: { _ends_with: '.com' } }, { v: 'x.org' })[0]!.extensions).toStrictEqual({
			field: 'v',
			path: [],
			type: 'ends_with',
			substring: '.com',
		});

		expect(validatePayload({ v: { _ends_with: '$5' } }, { v: 'x' })[0]!.extensions).toStrictEqual({
			field: 'v',
			path: [],
			type: 'ends_with',
			substring: '$5',
		});

		// The negated and case-insensitive forms report their own operator with the same substring
		expect(validatePayload({ v: { _nistarts_with: 'a.' } }, { v: 'A.b' })[0]!.extensions).toStrictEqual({
			field: 'v',
			path: [],
			type: 'nistarts_with',
			substring: 'a.',
		});
	});

	it('reports an infinite number against a range operator as unsafe instead of throwing', () => {
		// Joi rejects `Infinity` with a rule of its own; it must map like the out-of-safe-range case, since a
		// transport layer expecting an error array cannot handle a plain throw
		for (const value of [Infinity, -Infinity]) {
			const errors = validatePayload({ v: { _gt: 1 } }, { v: value });

			expect(errors).toHaveLength(1);
			expect(errors[0]!.extensions).toStrictEqual({ field: 'v', path: [], type: 'unsafe' });
		}
	});

	it('reports a value inside the _nbetween range as nbetween instead of throwing', () => {
		// The exact input `_nbetween` exists to reject surfaced as an unmapped `alternatives.match` before, which
		// crashed the converter with a plain error; it must come back as one structured validation error
		const errors = validatePayload({ v: { _nbetween: [1, 3] } }, { v: 2 });

		expect(errors).toHaveLength(1);
		expect(errors[0]).toBeInstanceOf(FailedValidationError);
		expect(errors[0]!.extensions).toStrictEqual({ field: 'v', path: [], type: 'nbetween', valid: [1, 3] });
	});

	it('reports a date inside the _nbetween range as nbetween with ISO bounds', () => {
		// The date form fails the same way; the bounds come back as the ISO strings the caller can echo
		const errors = validatePayload(
			{ v: { _nbetween: ['2024-01-01T00:00:00.000Z', '2024-01-03T00:00:00.000Z'] } },
			{ v: '2024-01-02T00:00:00.000Z' },
		);

		expect(errors).toHaveLength(1);

		expect(errors[0]!.extensions).toStrictEqual({
			field: 'v',
			path: [],
			type: 'nbetween',
			valid: ['2024-01-01T00:00:00.000Z', '2024-01-03T00:00:00.000Z'],
		});
	});

	it('reports values failing malformed range and list operators as failed fields instead of throwing', () => {
		// A filter is caller-supplied data and may be malformed; the payload must not pay with a thrown
		// `TypeError` / Joi assert out of schema building — each `_in` / range rule degrades to the never-validating
		// schema, so the field fails as one structured error instead of the call crashing
		const cases: [Filter, Record<string, unknown>][] = [
			[{ v: { _in: 5 } } as Filter, { v: 'anything' }],
			[{ v: { _gt: 'garbage' } }, { v: 'anything' }],
			[{ v: { _between: [5] } }, { v: 5 }],
			[{ v: { _nbetween: [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 2] } }, { v: 0 }],
		];

		for (const [filter, payload] of cases) {
			const errors = validatePayload(filter, payload);

			expect(errors).toHaveLength(1);
			expect(errors[0]).toBeInstanceOf(FailedValidationError);
			expect(errors[0]!.code).toBe('FAILED_VALIDATION');
		}

		// A malformed `_nin` degrades the other way: forbidding nothing passes everything
		expect(validatePayload({ v: { _nin: null } } as Filter, { v: 'anything' })).toStrictEqual([]);
	});

	it('fails `true` against a malformed rule instead of letting it through', () => {
		// The never-validating fallback used to be `equal(true)`, so a JSON `true` passed a rule meant to reject
		// everything; every malformed shape must now report the field
		const filters = [
			{ role: { _in: [] } },
			{ role: { _contains: 5 } },
			{ role: { _regex: '(' } },
			{ role: { _gt: 'garbage' } },
			{ role: { _between: [1] } },
		] as Filter[];

		for (const filter of filters) {
			const errors = validatePayload(filter, { role: true });

			expect(errors).toHaveLength(1);
			expect(errors[0]!.extensions).toStrictEqual({ field: 'role', path: [], type: 'in', valid: [] });
		}
	});

	test.each([
		['a bare string rule', { status: 'published' }],
		['a bare number rule', { age: 18 }],
		['two operators on one field', { age: { _gte: 18, _lte: 65 } }],
		['two fields on one level', { age: { _gte: 18 }, name: { _eq: 'a' } }],
		['a field next to a logical group', { _and: [{ age: { _gte: 18 } }], name: { _eq: 'a' } }],
		['a bare rule inside a logical group', { _and: [{ status: 'published' }] }],
	])('throws a plain Error for %s instead of skipping or overflowing', (_label, filter) => {
		// Each of these used to either recurse until the stack overflowed or drop a rule and pass the payload; a
		// malformed filter is a caller bug, so it fails loudly
		expect(() => validatePayload(filter as unknown as Filter, { status: 'x', age: 100, name: 'b' })).toThrowError(
			/^\[@novastarter\/validation\] (generateJoi|validatePayload): /,
		);
	});

	describe('empty string against the substring operators', () => {
		test.each([
			['_contains', 'contains'],
			['_starts_with', 'starts_with'],
			['_istarts_with', 'istarts_with'],
			['_ends_with', 'ends_with'],
			['_iends_with', 'iends_with'],
		])("%s fails on the rule with the substring, not on Joi's empty-string check", (operator, type) => {
			// A blank form field is the most common input; it must fail on the operator, with the substring in
			// the extensions, rather than escape as an unmapped `string.empty` and throw
			const errors = validatePayload({ email: { [operator]: '@' } } as Filter, { email: '' });

			expect(errors).toHaveLength(1);
			expect(errors[0]!.extensions).toStrictEqual({ field: 'email', path: [], type, substring: '@' });
		});

		test.each(['_ncontains', '_nstarts_with', '_nistarts_with', '_nends_with', '_niends_with'])(
			'%s passes, since an empty string contains nothing',
			(operator) => {
				// The negated forms have nothing to reject in `''`, so the payload is valid
				expect(validatePayload({ email: { [operator]: '@' } } as Filter, { email: '' })).toStrictEqual([]);
			},
		);

		test('_icontains fails on its own rule with the substring', () => {
			// The case-insensitive form reaches its own rule, so the error carries the `icontains` operator rather
			// than being reported as `contains`
			const errors = validatePayload({ email: { _icontains: '@' } } as Filter, { email: '' });

			expect(errors).toHaveLength(1);

			expect(errors[0]!.extensions).toStrictEqual({
				field: 'email',
				path: [],
				type: 'icontains',
				substring: '@',
			});
		});

		test('inside a logical group', () => {
			// The leaf goes through the same schema builder inside `_and` / `_or`, so the fix must hold there too
			const errors = validatePayload({ _or: [{ email: { _contains: '@' } }] } as Filter, { email: '' });

			expect(errors).toHaveLength(1);
			expect(errors[0]!.extensions).toStrictEqual({ field: 'email', path: [], type: 'contains', substring: '@' });
		});
	});

	describe('validates operator: _contains', () => {
		const mockFilter = {
			_and: [
				{
					value: {
						_contains: 'MATCH-EXACT',
					},
				},
			],
		};

		const options = { requireAll: true };

		test('string values', () => {
			// The match is case-sensitive and anywhere in the value
			expect(validatePayload(mockFilter, { value: 'MATCH-EXACT' }, options)).toHaveLength(0);
			expect(validatePayload(mockFilter, { value: 'substring-MATCH-EXACT' }, options)).toHaveLength(0);

			expect(validatePayload(mockFilter, { value: 'match-exact' }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: 'mismatch' }, options)).toHaveLength(1);
		});

		test('array values', () => {
			// One matching item is enough, other items may be of any type; no matching item is one error
			expect(validatePayload(mockFilter, { value: [123, 'MATCH-EXACT'] }, options)).toHaveLength(0);

			expect(validatePayload(mockFilter, { value: [123, 'match-exact'] }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: [] }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: ['mismatch'] }, options)).toHaveLength(1);
		});

		test('other values', () => {
			// Anything that is neither a string nor an array fails by type, `undefined` by `requireAll`
			expect(validatePayload(mockFilter, { value: null }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: undefined }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: 123 }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: {} }, options)).toHaveLength(1);
		});
	});

	describe('validates operator: _icontains', () => {
		const mockFilter = {
			_and: [
				{
					value: {
						_icontains: 'match-insensitive',
					},
				},
			],
		};

		const options = { requireAll: true };

		test('string values', () => {
			// The case of the value does not matter, the position does not either
			expect(validatePayload(mockFilter, { value: 'MATCH-insensitive' }, options)).toHaveLength(0);
			expect(validatePayload(mockFilter, { value: 'match-insensitive' }, options)).toHaveLength(0);
			expect(validatePayload(mockFilter, { value: 'substring-match-insensitive' }, options)).toHaveLength(0);

			expect(validatePayload(mockFilter, { value: 'mismatch' }, options)).toHaveLength(1);
		});

		test('array values', () => {
			// One item matching in any case is enough
			expect(validatePayload(mockFilter, { value: [123, 'match-insensitive'] }, options)).toHaveLength(0);
			expect(validatePayload(mockFilter, { value: [123, 'MATCH-insensitive'] }, options)).toHaveLength(0);
			expect(validatePayload(mockFilter, { value: [123, 'substring-MATCH-insensitive'] }, options)).toHaveLength(0);

			expect(validatePayload(mockFilter, { value: [] }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: ['mismatch'] }, options)).toHaveLength(1);
		});

		test('other values', () => {
			// Anything that is neither a string nor an array fails by type, `undefined` by `requireAll`
			expect(validatePayload(mockFilter, { value: null }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: undefined }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: 123 }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: {} }, options)).toHaveLength(1);
		});
	});

	describe('validates operator: _ncontains', () => {
		const mockFilter = {
			_and: [
				{
					value: {
						_ncontains: 'match',
					},
				},
			],
		};

		const options = { requireAll: true };

		test('string values', () => {
			// The check is case-sensitive, so `'MATCH'` does not count as containing `'match'`
			expect(validatePayload(mockFilter, { value: 'foo' }, options)).toHaveLength(0);
			expect(validatePayload(mockFilter, { value: 'MATCH' }, options)).toHaveLength(0);

			expect(validatePayload(mockFilter, { value: 'match' }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: 'substring-match' }, options)).toHaveLength(1);
		});

		test('array values', () => {
			// An empty array contains nothing; a single item containing the substring fails the whole array
			expect(validatePayload(mockFilter, { value: [] }, options)).toHaveLength(0);
			expect(validatePayload(mockFilter, { value: ['foo'] }, options)).toHaveLength(0);
			expect(validatePayload(mockFilter, { value: ['MATCH'] }, options)).toHaveLength(0);

			expect(validatePayload(mockFilter, { value: ['foo', 'match'] }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: ['substring-match'] }, options)).toHaveLength(1);
		});

		test('array values with several forbidden items', () => {
			// Two offending items must still yield one `ncontains` error, pointing at the first one, instead of a throw
			const errors = validatePayload(mockFilter, { value: ['match-1', 'match-2'] }, options);

			expect(errors).toHaveLength(1);
			expect(errors[0]!.extensions).toStrictEqual({ field: 'value', path: [0], type: 'ncontains' });
		});

		test('other values', () => {
			// Anything that is neither a string nor an array fails by type, `undefined` by `requireAll`
			expect(validatePayload(mockFilter, { value: null }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: undefined }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: 123 }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: {} }, options)).toHaveLength(1);
		});
	});

	describe('validates operator: _regex', () => {
		const mockFilter = {
			_and: [
				{
					value: {
						_regex: '^$|foo',
					},
				},
			],
		};

		const options = { requireAll: true };

		test('string value', () => {
			// A bare pattern is applied as is
			expect(validatePayload(mockFilter, { value: 'foo' }, options)).toHaveLength(0);

			expect(validatePayload(mockFilter, { value: 'bar' }, options)).toHaveLength(1);
		});

		test('other values', () => {
			// The empty string reaches the pattern, which allows it here; a missing or null value still fails
			expect(validatePayload(mockFilter, { value: '' }, options)).toHaveLength(0);

			expect(validatePayload(mockFilter, { value: undefined }, options)).toHaveLength(1);
			expect(validatePayload(mockFilter, { value: null }, options)).toHaveLength(1);
		});
	});
});
