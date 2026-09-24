/**
 * Tests of `validation/lib/generate-joi`.
 */
import type { FieldFilter } from '@novastarter/types';
import type { AnySchema } from 'joi';
import { describe, expect, it, test } from 'vitest';
import type { JoiOptions, StringSchema } from './generate-joi.js';
import { generateJoi, Joi, never } from './generate-joi.js';

/**
 * Assert that a filter builds the expected schema.
 *
 * Joi schemas are not structurally comparable (they hold caches and functions), so both sides are compared through
 * `describe()`, which is a plain object of the type and the rules.
 *
 * @param filter - Field filter handed to `generateJoi`.
 * @param expected - Schema of the single field the filter names; it is wrapped into the same object schema
 * `generateJoi` builds.
 * @param options - Options handed to `generateJoi`.
 */
const expectSchema = (filter: unknown, expected: AnySchema, options?: JoiOptions) => {
	// `generateJoi` always answers with an object schema that allows unknown keys, so only the field rule varies
	const mockSchema = Joi.object({ field: expected }).unknown().describe();

	expect(generateJoi(filter as FieldFilter, options).describe()).toStrictEqual(mockSchema);
};

/**
 * String base every string operator starts from: `min(0)`, so an empty string reaches the rule.
 *
 * @returns A fresh extended string schema.
 */
const string = () => Joi.string().min(0) as StringSchema;

describe(`generateJoi`, () => {
	/** Fixed instant, so the date expectations are stable. */
	const date = new Date(1632431505992);
	/** Later instant for the two-bound operators. */
	const compareDate = new Date(1632431605992);

	it(`returns an error when no key is passed`, () => {
		// A filter without a field is a caller bug; the message names the filter so the caller can find it
		const mockError = `[@novastarter/validation] generateJoi: Filter doesn't contain field key. Passed filter: {}`;

		expect(() => {
			generateJoi({} as FieldFilter);
		}).toThrowError(mockError);
	});

	it(`returns an error when no filter rule is passed`, () => {
		// An undefined rule value is dropped by `JSON.stringify`, hence the empty object in the message
		const mockFieldFilter = { field: { eq: undefined } } as unknown as FieldFilter;
		const mockError = `[@novastarter/validation] generateJoi: Filter doesn't contain filter rule. Passed filter: {}`;

		expect(() => {
			generateJoi(mockFieldFilter);
		}).toThrowError(mockError);
	});

	test.each([
		['a string', { status: 'published' }],
		['a number', { age: 18 }],
		['a boolean', { active: true }],
		['an array', { role: ['admin'] }],
		['an empty object', { age: {} }],
		['a string in a nested filter', { author: { name: 'Ada' } }],
	])(`throws when the rule is %s instead of an operator object`, (_label, filter) => {
		// A bare string used to be walked as a nested filter of its characters and overflow the stack, and the
		// other shapes left the field unconstrained; every one of them must fail as a plain, catchable Error
		expect(() => generateJoi(filter as unknown as FieldFilter)).toThrowError(
			/^\[@novastarter\/validation\] generateJoi: Filter doesn't contain filter rule\./,
		);
	});

	it(`throws when a filter holds more than one field key`, () => {
		// Only one field is turned into a rule, so the second one would be skipped silently
		expect(() => generateJoi({ age: { _gte: 18 }, name: { _eq: 'a' } })).toThrowError(
			/^\[@novastarter\/validation\] generateJoi: Filter contains more than one field key/,
		);
	});

	it(`throws when a field holds more than one operator`, () => {
		// A range written as `{ _gte, _lte }` would otherwise enforce only its lower bound
		expect(() => generateJoi({ age: { _gte: 18, _lte: 65 } })).toThrowError(
			/^\[@novastarter\/validation\] generateJoi: Filter contains more than one operator for field "age"/,
		);
	});

	test.each([true, false, null, 'x', 0, {}, []])(`the never-validating schema rejects %j`, (value) => {
		// The fallback of malformed rules used to be `equal(true)`, which let the boolean `true` through; it must
		// fail every present value with `any.only` and an empty allow list
		const { error } = generateJoi({ field: { _in: [] } }).validate({ field: value });

		expect(error?.details.map((detail) => [detail.type, detail.context?.['valids']])).toStrictEqual([['any.only', []]]);
	});

	it(`the never-validating schema still skips a missing field`, () => {
		// Like every other rule, presence is only enforced with `requireAll`
		expect(generateJoi({ field: { _in: [] } }).validate({}).error).toBeUndefined();
	});

	it(`returns an recursively goes through nested filters`, () => {
		// A value whose first key is not an operator is a nested filter, so the field gets an object schema
		expectSchema({ field: { eq: { _eq: 'field' } } }, Joi.object({ eq: Joi.any().equal('field') }).unknown());
	});

	it(`returns the correct schema with an option of "requireAll" true`, () => {
		// `requireAll` marks the field required, so a missing field fails instead of being skipped
		expectSchema({ field: { _eq: 'field' } }, Joi.any().equal('field').required(), { requireAll: true });
	});

	it(`returns the correct schema for an _eq match`, () => {
		// A non-numeric string has no numeric twin, so only the value itself is allowed
		expectSchema({ field: { _eq: 'field' } }, Joi.any().equal('field'));
	});

	it(`returns the correct schema for a _neq match`, () => {
		// A non-numeric string has no numeric twin, so only the value itself is forbidden
		expectSchema({ field: { _neq: 'field' } }, Joi.any().not('field'));
	});

	it(`returns the correct schema for an integer _eq match`, () => {
		// A number is allowed together with its string form, so a form field sending `'123'` still matches
		expectSchema({ field: { _eq: 123 } }, Joi.any().equal(123, '123'));
	});

	it(`returns the correct schema for an integer _neq match`, () => {
		// Both forms of the number are forbidden, otherwise `'123'` would slip past `_neq: 123`
		expectSchema({ field: { _neq: 123 } }, Joi.any().not(123, '123'));
	});

	it(`returns the correct schema for a string containing an integer _eq match`, () => {
		// A numeric string gets its number as the twin, in the caller's order: the string first
		expectSchema({ field: { _eq: '123' } }, Joi.any().equal('123', 123));
	});

	it(`returns the correct schema for a string containing an integer _neq match`, () => {
		// A numeric string gets its number as the twin, in the caller's order: the string first
		expectSchema({ field: { _neq: '123' } }, Joi.any().not('123', 123));
	});

	it(`returns the correct schema for a float _eq match`, () => {
		// The twin logic is not limited to integers
		expectSchema({ field: { _eq: '123.456' } }, Joi.any().equal('123.456', 123.456));
	});

	it(`returns the correct schema for a float _neq match`, () => {
		// The twin logic is not limited to integers
		expectSchema({ field: { _neq: '123.456' } }, Joi.any().not('123.456', 123.456));
	});

	it(`returns the correct schema for a null _eq match`, () => {
		// `Number(null)` is `0`, which must not become a twin; null is compared as it is
		expectSchema({ field: { _eq: null } }, Joi.any().equal(null));
	});

	it(`returns the correct schema for a null _neq match`, () => {
		// `Number(null)` is `0`, which must not become a twin; null is compared as it is
		expectSchema({ field: { _neq: null } }, Joi.any().not(null));
	});

	it(`returns the correct schema for an empty string _eq match`, () => {
		// `Number('')` is `0`, which must not become a twin; the empty string is compared as it is
		expectSchema({ field: { _eq: '' } }, Joi.any().equal(''));
	});

	it(`returns the correct schema for an empty string _neq match`, () => {
		// `Number('')` is `0`, which must not become a twin; the empty string is compared as it is
		expectSchema({ field: { _neq: '' } }, Joi.any().not(''));
	});

	it(`returns the correct schema for a true _eq match`, () => {
		// `Number(true)` is `1`, which must not become a twin; booleans are compared as they are
		expectSchema({ field: { _eq: true } }, Joi.any().equal(true));
	});

	it(`returns the correct schema for a true _neq match`, () => {
		// `Number(true)` is `1`, which must not become a twin; booleans are compared as they are
		expectSchema({ field: { _neq: true } }, Joi.any().not(true));
	});

	it(`returns the correct schema for a false _eq match`, () => {
		// `Number(false)` is `0`, which must not become a twin; booleans are compared as they are
		expectSchema({ field: { _eq: false } }, Joi.any().equal(false));
	});

	it(`returns the correct schema for a false _neq match`, () => {
		// `Number(false)` is `0`, which must not become a twin; booleans are compared as they are
		expectSchema({ field: { _neq: false } }, Joi.any().not(false));
	});

	it(`accepts a value that contains the substring`, () => {
		// `Joi.assert` throws on failure, so the rule passing is the absence of a throw
		expect(() => Joi.assert('testfield', (Joi.string() as StringSchema).contains('field'))).not.toThrow();
	});

	it(`accepts a value that contains the substring in another case for icontains`, () => {
		// Both sides are lower-cased, so the case of neither the value nor the substring matters
		expect(() => Joi.assert('TESTFIELD', (Joi.string() as StringSchema).icontains('Field'))).not.toThrow();
	});

	it(`returns an error if the substring is included in the value`, () => {
		// `ncontains` fails on presence; the message names the substring so the caller sees what was forbidden
		expect(() => {
			Joi.assert('field', (Joi.string() as StringSchema).ncontains('field'));
		}).toThrowError(`"value" can't contain [field]`);
	});

	it(`returns an error if the substring is not contained in the value`, () => {
		// `contains` fails on absence; the message names the substring so the caller sees what was expected
		expect(() => {
			Joi.assert('test', (Joi.string() as StringSchema).contains('field'));
		}).toThrowError(`"value" must contain [field]`);
	});

	it.each([
		['starts_with', 'field-x', 'x-field', `"value" must start with [field]`],
		['nstarts_with', 'x-field', 'field-x', `"value" can't start with [field]`],
		['istarts_with', 'FIELD-x', 'x-field', `"value" must start with case insensitive [field]`],
		['nistarts_with', 'x-field', 'FIELD-x', `"value" can't start with case insensitive [field]`],
		['ends_with', 'x-field', 'field-x', `"value" must end with [field]`],
		['nends_with', 'field-x', 'x-field', `"value" can't end with [field]`],
		['iends_with', 'x-FIELD', 'field-x', `"value" must end with case insensitive [field]`],
		['niends_with', 'field-x', 'x-FIELD', `"value" can't end with case insensitive [field]`],
	] as const)(
		`checks the %s rule on the value and names the substring in the message`,
		(rule, passing, failing, message) => {
			// Every prefix / suffix rule is registered on the extended Joi, so it can be composed like `contains`
			const schema = (Joi.string() as StringSchema)[rule]('field');

			expect(() => Joi.assert(passing, schema)).not.toThrow();
			expect(() => Joi.assert(failing, schema)).toThrowError(message);
		},
	);

	it(`lets an empty string reach the substring rules`, () => {
		// Joi's stock string rejects `''` outright; the generated schema must fail on the rule instead, so the
		// error carries the operator and the substring rather than an unmapped `string.empty`
		const { error } = generateJoi({ field: { _contains: '@' } }).validate({ field: '' });

		expect(error?.details.map((detail) => detail.type)).toStrictEqual(['string.contains']);

		// The negated form passes on an empty string, since it contains nothing
		expect(generateJoi({ field: { _ncontains: '@' } }).validate({ field: '' }).error).toBeUndefined();
	});

	it(`returns the correct schema for a _starts_with match`, () => {
		// The operator is a rule named after it, so the error can carry the original substring
		expectSchema({ field: { _starts_with: 'field' } }, string().starts_with('field'));
	});

	it(`returns the correct schema for a _starts_with with null value`, () => {
		// A non-string compare value can match nothing, so the rule fails for any real value
		expectSchema({ field: { _starts_with: null } }, never());
	});

	it(`returns the correct schema for a _nstarts_with with match`, () => {
		// The negated operator is its own rule rather than an inverted pattern
		expectSchema({ field: { _nstarts_with: 'field' } }, string().nstarts_with('field'));
	});

	it(`returns the correct schema for a _nstarts_with with null value`, () => {
		// A non-string compare value can match nothing, so the rule fails for any real value
		expectSchema({ field: { _nstarts_with: null } }, never());
	});

	it(`returns the correct schema for a _istarts_with match`, () => {
		// The case-insensitive operator is its own rule rather than a pattern with the `i` flag
		expectSchema({ field: { _istarts_with: 'field' } }, string().istarts_with('field'));
	});

	it(`returns the correct schema for a _istarts_with with null value`, () => {
		// A non-string compare value can match nothing, so the rule fails for any real value
		expectSchema({ field: { _istarts_with: null } }, never());
	});

	it(`returns the correct schema for a _nistarts_with match`, () => {
		// The negated, case-insensitive operator is its own rule
		expectSchema({ field: { _nistarts_with: 'field' } }, string().nistarts_with('field'));
	});

	it(`returns the correct schema for a _nistarts_with with null value`, () => {
		// A non-string compare value can match nothing, so the rule fails for any real value
		expectSchema({ field: { _nistarts_with: null } }, never());
	});

	it(`returns the correct schema for an ends_with match`, () => {
		// The operator is a rule named after it, so the error can carry the original substring
		expectSchema({ field: { _ends_with: 'field' } }, string().ends_with('field'));
	});

	it(`returns the correct schema for an ends_with with null value`, () => {
		// A non-string compare value can match nothing, so the rule fails for any real value
		expectSchema({ field: { _ends_with: null } }, never());
	});

	it(`returns the correct schema for a doesnt _nends_with match`, () => {
		// The negated operator is its own rule rather than an inverted pattern
		expectSchema({ field: { _nends_with: 'field' } }, string().nends_with('field'));
	});

	it(`returns the correct schema for a doesnt _nends_with with null value`, () => {
		// A non-string compare value can match nothing, so the rule fails for any real value
		expectSchema({ field: { _nends_with: null } }, never());
	});

	it(`returns the correct schema for an iends_with match`, () => {
		// The case-insensitive operator is its own rule rather than a pattern with the `i` flag
		expectSchema({ field: { _iends_with: 'field' } }, string().iends_with('field'));
	});

	it(`returns the correct schema for an iends_with with null value`, () => {
		// A non-string compare value can match nothing, so the rule fails for any real value
		expectSchema({ field: { _iends_with: null } }, never());
	});

	it(`returns the correct schema for a doesnt _niends_with match`, () => {
		// The negated, case-insensitive operator is its own rule
		expectSchema({ field: { _niends_with: 'field' } }, string().niends_with('field'));
	});

	it(`returns the correct schema for a doesnt _niends_with with null value`, () => {
		// A non-string compare value can match nothing, so the rule fails for any real value
		expectSchema({ field: { _niends_with: null } }, never());
	});

	it(`returns the correct schema for an _in match`, () => {
		// A string is spread like an array, so each character becomes an allowed value; that is how the operator
		// has always behaved and the schema builder does not second-guess it
		expectSchema({ field: { _in: 'field' } }, Joi.any().equal(...'field'));
	});

	it(`returns the correct schema for an _in number array match`, () => {
		// The list is spread into Joi's allow list as is, no numeric twins
		expectSchema({ field: { _in: [1] } }, Joi.any().equal(...[1]));
	});

	it(`returns the correct schema for an _in a string array match`, () => {
		// The list is spread into Joi's allow list as is
		expectSchema({ field: { _in: ['field', 'secondField'] } }, Joi.any().equal(...['field', 'secondField']));
	});

	it(`returns the correct schema for a _nin match`, () => {
		// A string is spread like an array, mirroring `_in`
		expectSchema({ field: { _nin: 'field' } }, Joi.any().not(...'field'));
	});

	it(`returns the correct schema for an _nin number array match`, () => {
		// The list is spread into Joi's deny list as is, no numeric twins
		expectSchema({ field: { _nin: [1] } }, Joi.any().not(...[1]));
	});

	it(`returns the correct schema for an _nin a string array match`, () => {
		// The list is spread into Joi's deny list as is
		expectSchema({ field: { _nin: ['field', 'secondField'] } }, Joi.any().not(...['field', 'secondField']));
	});

	it(`fails every value for an _in match with an empty list`, () => {
		// Nothing is a member of an empty list: the field fails for any value, through the never-validating schema
		// the malformed compare values get — `describe()` alone pinned a passing schema before
		expectSchema({ field: { _in: [] } }, never());

		const { error } = generateJoi({ field: { _in: [] } }).validate({ field: 'anything' });

		expect(error).toBeDefined();
	});

	it(`passes every value for a _nin match with an empty list`, () => {
		// An empty list forbids nothing, so every value passes — the vacuous truth of "not in nothing", stated
		// behaviourally since a no-op `any` schema admits anything
		const { error } = generateJoi({ field: { _nin: [] } }).validate({ field: 'anything' });

		expect(error).toBeUndefined();
	});

	it(`fails every value for an _in match with a non-array, non-string value`, () => {
		// A number cannot hold a list of allowed values: spreading it would throw a `TypeError`, so the rule
		// degrades to the never-validating schema the malformed compare values get — the documented string spread
		// above keeps working
		expectSchema({ field: { _in: 5 } }, never());

		const { error } = generateJoi({ field: { _in: 5 } } as unknown as FieldFilter).validate({ field: 'anything' });

		expect(error).toBeDefined();
	});

	it(`passes every value for a _nin match with a non-array, non-string value`, () => {
		// `null` cannot hold forbidden values, so forbidding nothing passes everything, like the empty list above —
		// instead of throwing a `TypeError` on the spread of a non-iterable
		expectSchema({ field: { _nin: null } }, Joi.any());

		const { error } = generateJoi({ field: { _nin: null } } as unknown as FieldFilter).validate({ field: 'anything' });

		expect(error).toBeUndefined();
	});

	it(`returns the correct schema for an _gt number match`, () => {
		// A numeric compare value selects the number schema, where "greater" is the exclusive bound
		expectSchema({ field: { _gt: 1 } }, Joi.number().greater(1));
	});

	it(`returns the correct schema for an _gt date match`, () => {
		// A `Date` selects the date schema without the caller declaring the type
		expectSchema({ field: { _gt: date } }, Joi.date().greater(date));
	});

	it(`returns the correct schema for an _gt string match`, () => {
		// A string that does not parse as a number is read as a date, so ISO strings work as bounds
		expectSchema({ field: { _gt: date.toISOString() } }, Joi.date().greater(date));
	});

	it(`returns the correct schema for an _gte number match`, () => {
		// Joi names the inclusive lower bound `min`
		expectSchema({ field: { _gte: 1 } }, Joi.number().min(1));
	});

	it(`returns the correct schema for an _gte date match`, () => {
		// A `Date` selects the date schema without the caller declaring the type
		expectSchema({ field: { _gte: date } }, Joi.date().min(date));
	});

	it(`returns the correct schema for an _gte string match`, () => {
		// A string that does not parse as a number is read as a date
		expectSchema({ field: { _gte: date.toISOString() } }, Joi.date().min(date));
	});

	it(`returns the correct schema for an _lt number match`, () => {
		// A numeric compare value selects the number schema, where "less" is the exclusive bound
		expectSchema({ field: { _lt: 1 } }, Joi.number().less(1));
	});

	it(`returns the correct schema for an _lt date match`, () => {
		// A `Date` selects the date schema without the caller declaring the type
		expectSchema({ field: { _lt: date } }, Joi.date().less(date));
	});

	it(`returns the correct schema for an _lt string match`, () => {
		// A string that does not parse as a number is read as a date
		expectSchema({ field: { _lt: date.toISOString() } }, Joi.date().less(date));
	});

	it(`returns the correct schema for an _lte number match`, () => {
		// Joi names the inclusive upper bound `max`
		expectSchema({ field: { _lte: 1 } }, Joi.number().max(1));
	});

	it(`returns the correct schema for an _lte date match`, () => {
		// A `Date` selects the date schema without the caller declaring the type
		expectSchema({ field: { _lte: date } }, Joi.date().max(date));
	});

	it(`returns the correct schema for an _lte string match`, () => {
		// A string that does not parse as a number is read as a date
		expectSchema({ field: { _lte: date.toISOString() } }, Joi.date().max(date));
	});

	it.each(['_gt', '_gte', '_lt', '_lte'])(
		`fails every value for %s with a string bound that is neither numeric nor a date`,
		(operator) => {
			// An unparseable string bound can never be reached by a real value: the rule degrades to the
			// never-validating schema, instead of Joi throwing an assert at schema-build time
			expectSchema({ field: { [operator]: 'garbage' } }, never());

			const { error } = generateJoi({ field: { [operator]: 'garbage' } } as FieldFilter).validate({
				field: 'anything',
			});

			expect(error).toBeDefined();
		},
	);

	it(`returns the correct schema for an _null match`, () => {
		// The null check is an allow list with a single entry, so it reports as `any.only`
		expectSchema({ field: { _null: null } }, Joi.any().valid(null));
	});

	it(`returns the correct schema for an _nnull match`, () => {
		// The not-null check is a deny list with a single entry, so it reports as `any.invalid`
		expectSchema({ field: { _nnull: null } }, Joi.any().invalid(null));
	});

	it(`returns the correct schema for an _empty match`, () => {
		// The empty check is an allow list holding only the empty string
		expectSchema({ field: { _empty: '' } }, Joi.any().valid(''));
	});

	it(`returns the correct schema for an _nempty match`, () => {
		// The not-empty check is a deny list holding only the empty string
		expectSchema({ field: { _nempty: '' } }, Joi.any().invalid(''));
	});

	it(`returns the correct schema for an _between number match`, () => {
		// Two safe numbers select the number schema with both bounds inclusive
		expectSchema({ field: { _between: [1, 3] } }, Joi.number().min(1).max(3));
	});

	it(`returns the correct schema for an _between float match`, () => {
		// Floats are safe numbers too, so they stay numeric rather than becoming dates
		expectSchema({ field: { _between: [1.111, 3.333] } }, Joi.number().min(1.111).max(3.333));
	});

	it(`returns the correct schema for an _between date match`, () => {
		// Dates are never read as numbers, even though `Number(date)` would give a timestamp
		expectSchema({ field: { _between: [date, compareDate] } }, Joi.date().min(date).max(compareDate));
	});

	it(`returns the correct schema for an _nbetween number match`, () => {
		// The complement of a range is "below the low bound" or "above the high bound"; Joi ANDs the rules of one
		// schema, so the "or" needs two alternatives
		expectSchema(
			{ field: { _nbetween: [1, 3] } },
			Joi.alternatives().try(Joi.number().less(1), Joi.number().greater(3)),
		);
	});

	it(`returns the correct schema for an _nbetween float match`, () => {
		// Floats are safe numbers too, so they stay numeric rather than becoming dates
		expectSchema(
			{ field: { _nbetween: [1.111, 3.333] } },
			Joi.alternatives().try(Joi.number().less(1.111), Joi.number().greater(3.333)),
		);
	});

	it(`returns the correct schema for an _nbetween date match`, () => {
		// Dates take the same complement on the date schema
		expectSchema(
			{ field: { _nbetween: [date, compareDate] } },
			Joi.alternatives().try(Joi.date().less(date), Joi.date().greater(compareDate)),
		);
	});

	it(`returns the correct schema for an _between with a non-array value`, () => {
		// Bounds that are not an array cannot hold a range, so the rule fails for any real value instead of
		// throwing on `every`
		expectSchema({ field: { _between: '1,3' } }, never());
	});

	it(`returns the correct schema for an _nbetween with a non-array value`, () => {
		// The negated form fails the same way on malformed bounds
		expectSchema({ field: { _nbetween: '1,3' } }, never());
	});

	it(`_nbetween accepts values outside the range and rejects values inside`, () => {
		// `describe()` equality alone pinned the wrong schema before, so the complement is proven behaviourally:
		// inside the range fails, both sides outside pass
		const schema = generateJoi({ field: { _nbetween: [1, 3] } });

		expect(schema.validate({ field: 2 }).error).not.toBeUndefined();
		expect(schema.validate({ field: 0 }).error).toBeUndefined();
		expect(schema.validate({ field: 4 }).error).toBeUndefined();
	});

	it.each(['_between', '_nbetween'])(`fails every value for %s with fewer than two bounds`, (operator) => {
		// One bound leaves the other `undefined`, and Joi rejects `min` / `max` of `undefined` with an assert at
		// schema-build time: the rule degrades to the never-validating schema instead
		expectSchema({ field: { [operator]: [5] } }, never());

		const { error } = generateJoi({ field: { [operator]: [5] } } as FieldFilter).validate({ field: 'anything' });

		expect(error).toBeDefined();
	});

	it.each(['_between', '_nbetween'])(`fails every value for %s with unsafe numeric bounds`, (operator) => {
		// Bounds above `Number.MAX_SAFE_INTEGER` are neither safe numbers nor dates: the pair degrades to the
		// never-validating schema, instead of the date branch rejecting the raw numbers with an assert at
		// schema-build time
		expectSchema({ field: { [operator]: [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 2] } }, never());

		const { error } = generateJoi({
			field: { [operator]: [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 2] },
		} as FieldFilter).validate({ field: 'anything' });

		expect(error).toBeDefined();
	});

	it(`returns the correct schema for an _submitted match`, () => {
		// Only presence is asked for, whatever the value; the compare value is ignored
		expectSchema({ field: { _submitted: '' } }, Joi.any().required());
	});

	it(`returns the correct schema for an _regex match when wrapped`, () => {
		// Slashes around the pattern are stripped, so a pattern copied from a regex literal works
		expectSchema({ field: { _regex: '/.*field$/' } }, Joi.string().min(0).regex(new RegExp(`.*field$`)));
	});

	it(`returns the correct schema for an _regex match when unwrapped`, () => {
		// A bare pattern is used as is; `min(0)` comes from the string base, so `''` reaches the pattern
		expectSchema({ field: { _regex: '.*field$' } }, Joi.string().min(0).regex(new RegExp(`.*field$`)));
	});

	it(`returns the correct schema for an _regex match with null value`, () => {
		// A missing pattern can match nothing, so the rule fails for any real value
		expectSchema({ field: { _regex: null } }, never());
	});

	it(`fails any value for an _regex match with an invalid pattern`, () => {
		// `[` does not compile: instead of a `SyntaxError` out of schema building, the rule degrades to the
		// never-validating schema the malformed compare values get
		expectSchema({ field: { _regex: '[' } }, never());

		const { error } = generateJoi({ field: { _regex: '[' } }).validate({ field: 'anything' });

		expect(error).toBeDefined();
	});
});
