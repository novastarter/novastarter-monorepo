import type { FieldFilter } from '@novastarter/types';
import type {
	AnySchema,
	StringSchema as BaseStringSchema,
	CustomValidator,
	DateSchema,
	ExtensionRule,
	NumberSchema,
	SchemaInternals,
} from 'joi';
import BaseJoi from 'joi';
import { merge } from 'lodash-es';

/**
 * Joi string schema with the substring rules added by {@link Joi}.
 *
 * Joi's own string schema has no "contains" or "starts with" rule, so the eleven are registered as an extension and
 * typed here. The names are the filter operators without the underscore, which is what the error converter maps
 * them back to.
 */
export interface StringSchema extends BaseStringSchema {
	/** Require the string to contain `substring`, case-sensitive. */
	contains(substring: string): this;
	/** Require the string to contain `substring`, ignoring case. */
	icontains(substring: string): this;
	/** Forbid the string from containing `substring`, case-sensitive. */
	ncontains(substring: string): this;
	/** Require the string to start with `substring`, case-sensitive. */
	starts_with(substring: string): this;
	/** Forbid the string from starting with `substring`, case-sensitive. */
	nstarts_with(substring: string): this;
	/** Require the string to start with `substring`, ignoring case. */
	istarts_with(substring: string): this;
	/** Forbid the string from starting with `substring`, ignoring case. */
	nistarts_with(substring: string): this;
	/** Require the string to end with `substring`, case-sensitive. */
	ends_with(substring: string): this;
	/** Forbid the string from ending with `substring`, case-sensitive. */
	nends_with(substring: string): this;
	/** Require the string to end with `substring`, ignoring case. */
	iends_with(substring: string): this;
	/** Forbid the string from ending with `substring`, ignoring case. */
	niends_with(substring: string): this;
}

/**
 * Build one substring rule of the extended {@link Joi} string type.
 *
 * The eleven rules differ only in their name and in the check itself, so the argument validation, the registration
 * and the error report are shared. The substring goes into the error context under `substring`, so the error
 * converter can name what the value had to contain, start with or end with without reverse-engineering it.
 *
 * @param name - Rule name; surfaces as `string.<name>` in `ValidationErrorItem.type`.
 * @param passes - Check of the value against the substring; `false` reports the rule's error.
 * @returns Rule definition for `Joi.extend`.
 * @internal
 */
const substringRule = (
	name: string,
	passes: (value: string, substring: string) => boolean,
): ExtensionRule & ThisType<SchemaInternals> => ({
	args: [
		{
			name: 'substring',
			ref: true,
			assert: (val) => typeof val === 'string',
			message: 'must be a string',
		},
	],
	/**
	 * Register the rule with its substring.
	 *
	 * @param substring - Text the check compares the value against.
	 * @returns The schema with the rule added.
	 */
	method(substring: string) {
		return this.$_addRule({ name, args: { substring } });
	},
	/**
	 * Check the value.
	 *
	 * @param value - String under validation.
	 * @param helpers - Joi rule helpers, used to report the error.
	 * @param args - Rule arguments; only `substring`.
	 * @returns The value when it passes, otherwise a Joi error report.
	 */
	validate(value: string, helpers, { substring }) {
		// 1. Report with the substring in context, so the error can name what was expected
		if (!passes(value, substring)) {
			return helpers.error(`string.${name}`, { substring });
		}

		return value;
	},
});

/**
 * Joi instance used by the package: the stock one with the `contains` and `starts_with` / `ends_with` families
 * registered as string rules.
 *
 * The rule names surface in `ValidationErrorItem.type` as `string.contains`, `string.starts_with` etc., which is
 * what `joiValidationErrorItemToErrorExtensions` matches on. Use this instance, not `joi` directly, when composing
 * with schemas from {@link generateJoi}; the case-insensitive rules lower-case both sides, the negated ones flip the
 * check.
 *
 * @example
 * ```ts
 * const schema = generateJoi({ age: { _gte: 18 } }).concat(
 * 	Joi.object({ email: (Joi.string() as StringSchema).contains('@') }),
 * );
 *
 * schema.validate({ age: 3, email: 'nope' }, { abortEarly: false }).error?.details.map((detail) => detail.type);
 * // => ['number.min', 'string.contains']
 * ```
 */
export const Joi: typeof BaseJoi = BaseJoi.extend({
	type: 'string',
	base: BaseJoi.string(),
	messages: {
		'string.contains': '{{#label}} must contain [{{#substring}}]',
		'string.icontains': '{{#label}} must contain case insensitive [{{#substring}}]',
		'string.ncontains': "{{#label}} can't contain [{{#substring}}]",
		'string.starts_with': '{{#label}} must start with [{{#substring}}]',
		'string.nstarts_with': "{{#label}} can't start with [{{#substring}}]",
		'string.istarts_with': '{{#label}} must start with case insensitive [{{#substring}}]',
		'string.nistarts_with': "{{#label}} can't start with case insensitive [{{#substring}}]",
		'string.ends_with': '{{#label}} must end with [{{#substring}}]',
		'string.nends_with': "{{#label}} can't end with [{{#substring}}]",
		'string.iends_with': '{{#label}} must end with case insensitive [{{#substring}}]',
		'string.niends_with': "{{#label}} can't end with case insensitive [{{#substring}}]",
	},
	rules: {
		contains: substringRule('contains', (value, substring) => value.includes(substring)),
		icontains: substringRule('icontains', (value, substring) => value.toLowerCase().includes(substring.toLowerCase())),
		ncontains: substringRule('ncontains', (value, substring) => !value.includes(substring)),
		starts_with: substringRule('starts_with', (value, substring) => value.startsWith(substring)),
		nstarts_with: substringRule('nstarts_with', (value, substring) => !value.startsWith(substring)),
		istarts_with: substringRule('istarts_with', (value, substring) =>
			value.toLowerCase().startsWith(substring.toLowerCase()),
		),
		nistarts_with: substringRule(
			'nistarts_with',
			(value, substring) => !value.toLowerCase().startsWith(substring.toLowerCase()),
		),
		ends_with: substringRule('ends_with', (value, substring) => value.endsWith(substring)),
		nends_with: substringRule('nends_with', (value, substring) => !value.endsWith(substring)),
		iends_with: substringRule('iends_with', (value, substring) =>
			value.toLowerCase().endsWith(substring.toLowerCase()),
		),
		niends_with: substringRule(
			'niends_with',
			(value, substring) => !value.toLowerCase().endsWith(substring.toLowerCase()),
		),
	},
});

/**
 * Options of {@link generateJoi} and `validatePayload`.
 */
export type JoiOptions = {
	/** Mark every field in the filter as required, so a missing field fails instead of being skipped. */
	requireAll?: boolean;
};

/**
 * Options applied when the caller passes none.
 *
 * @defaultValue Fields are optional; a missing field passes.
 * @internal
 */
const defaults: JoiOptions = {
	requireAll: false,
};

/**
 * Tell whether the compare value of a two-bound operator is an array of exactly two entries that all parse as safe
 * numbers.
 *
 * A `Date` bound is never numeric — `Number(date)` would give a timestamp, which is not what a date bound means —
 * and an out-of-safe-range number cannot be compared exactly, so either makes the pair non-numeric. A numeric string
 * counts, mirroring the single-bound range operators.
 *
 * @param compareValue - Raw compare value of a `_between` / `_nbetween` rule.
 * @returns `true` when `compareValue` is an array of two entries each parseable as a safe number.
 * @internal
 */
const isSafeNumberPair = (compareValue: unknown): boolean =>
	// 1. Exactly two bounds are required: fewer leave a bound `undefined`, more are silently ignored otherwise
	Array.isArray(compareValue) &&
	compareValue.length === 2 &&
	// 2. Every bound must parse to a finite, safe number; `Date` bounds are excluded by forcing them to `NaN`
	compareValue.every((value) => {
		const val = Number(value instanceof Date ? NaN : value);

		return !Number.isNaN(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER;
	});

/**
 * Tell whether the compare value of a two-bound operator is an array of exactly two entries that are all `Date`
 * objects or strings parseable as dates.
 *
 * This is the fallback once {@link isSafeNumberPair} rejects the pair: raw numbers are not date bounds here (Joi
 * would throw on them at schema-build time), only genuine dates and date strings are.
 *
 * @param compareValue - Raw compare value of a `_between` / `_nbetween` rule.
 * @returns `true` when `compareValue` is an array of two entries each a `Date` or a parseable date string.
 * @internal
 */
const isDatePair = (compareValue: unknown): boolean =>
	// 1. Exactly two bounds, each a `Date` or a string `Date.parse` can read; a numeric string never gets here,
	//    because `isSafeNumberPair` claims it first
	Array.isArray(compareValue) &&
	compareValue.length === 2 &&
	compareValue.every(
		(value) => value instanceof Date || (typeof value === 'string' && !Number.isNaN(Date.parse(value))),
	);

/**
 * Custom Joi check behind {@link never}: reject whatever value reaches it.
 *
 * Kept at module level, so every schema {@link never} builds shares the same function and two of them compare equal
 * through `describe()`.
 *
 * @param _value - Value under validation; ignored, since every value fails.
 * @param helpers - Joi custom helpers, used to report the error.
 * @returns A Joi `any.only` error report with an empty allow list.
 * @internal
 */
const rejectEvery: CustomValidator = (_value, helpers) =>
	// 1. `any.only` with no allowed values is what the error converter reads as "one of nothing", so the failure
	//    stays a structured `in` error instead of an unmapped Joi type
	helpers.error('any.only', { valids: [] });

/**
 * Build the schema a malformed rule degrades to: one that no present value passes.
 *
 * A filter rule that cannot describe any value the payload could satisfy (an empty `_in` list, a non-string
 * substring, an unparseable range bound, a regex that does not compile) must fail the field rather than throw at
 * schema-build time or let the field through. An allow list such as `equal(true)` is not enough, since the one value
 * it names would pass; a custom check that always reports rejects `true`, `false`, `null` and everything else alike. A
 * missing field is still skipped unless `requireAll` is set, like every other rule.
 *
 * @returns A schema failing every present value with `any.only` and an empty allow list.
 * @internal
 */
export const never = (): AnySchema =>
	// 1. Joi runs custom checks on every present value, including `null` and booleans, so nothing slips past
	Joi.any().custom(rejectEvery, 'never');

/**
 * Build a Joi schema from one field filter.
 *
 * The filter holds a single field key whose value is either an operator object with a single operator
 * (`{ _gte: 18 }`) or another field filter for a nested object. Logical `_and` / `_or` groups are not handled here;
 * `validatePayload` splits them first, and several fields or several operators on one field are written as an
 * `_and`. Every schema is an object schema that allows unknown keys, so a payload may carry fields the filter never
 * mentions.
 *
 * @param filter - Field filter with exactly one field key; `null` is treated as an empty filter.
 * @param options - Schema options merged over {@link defaults}.
 * @returns Object schema with a rule for the filter's field.
 * @throws Plain `Error` when the filter has no field key or more than one, when the field's rule is not a non-empty
 * object (a bare value such as `{ status: 'published' }`, an array, `{}`), or when an operator object holds more
 * than one key; the same checks apply at every nesting level.
 * @example
 * ```ts
 * const schema = generateJoi({ age: { _gte: 18 } });
 *
 * schema.validate({ age: 3 }).error; // ValidationError
 * ```
 */
export function generateJoi(filter: FieldFilter | null, options?: JoiOptions): AnySchema {
	// 1. Normalise the inputs: a missing filter is empty, caller options win over the defaults
	filter = filter || {};

	options = merge({}, defaults, options);

	const schema: Record<string, AnySchema> = {};

	// 2. A filter describes exactly one field; anything else is a caller bug worth failing on. Only the first key is
	//    ever turned into a rule, so a second one would be dropped without a trace; failing loudly keeps a
	//    multi-field filter from passing payloads it was meant to reject
	const key = Object.keys(filter)[0];

	if (!key) {
		throw new Error(`[generateJoi] Filter doesn't contain field key. Passed filter: ${JSON.stringify(filter)}`);
	}

	if (Object.keys(filter).length > 1) {
		throw new Error(
			`[generateJoi] Filter contains more than one field key; combine them with "_and". Passed filter: ${JSON.stringify(filter)}`,
		);
	}

	const value: unknown = Object.values(filter)[0];

	// 3. The rule must be a non-empty plain object (an operator object or a nested filter). A bare value such as
	//    `{ status: 'published' }` is not shorthand equality here: a string would otherwise be walked as a nested
	//    filter of its characters and recurse forever, and a number, boolean, array or `{}` would leave the field
	//    unconstrained without a word
	if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length === 0) {
		throw new Error(`[generateJoi] Filter doesn't contain filter rule. Passed filter: ${JSON.stringify(filter)}`);
	}

	// 4. A value whose first key is not an operator is a nested field filter: recurse and nest the schema; the
	//    recursive call applies the same one-key checks to it
	if (!Object.keys(value)[0]!.startsWith('_')) {
		schema[key] = generateJoi(value as FieldFilter, options);
	} else {
		// 5. Otherwise the value is an operator object. Only one operator is applied per field, so a second one (or a
		//    field key mixed in with the operator) would be skipped silently; that is a caller bug worth failing on
		if (Object.keys(value).length > 1) {
			throw new Error(
				`[generateJoi] Filter contains more than one operator for field "${key}"; combine them with "_and". Passed filter: ${JSON.stringify(filter)}`,
			);
		}

		const operator = Object.keys(value)[0];
		const compareValue = Object.values(value)[0];

		// 6. Lazily pick the base schema for the operator at hand. The schema map is built fresh on every call and only
		//    the first operator of the value applies, so `schema[key]` is always unset here; each operator composes its
		//    own schema for the key from the typed base. The string base gets `min(0)`, because Joi's stock string
		//    rejects `''` with `string.empty` before any rule runs; a form field left blank must reach the substring
		//    rule and fail (or pass) on that rule instead
		const getAnySchema = () => schema[key] ?? Joi.any();
		const getStringSchema = () => (schema[key] ?? Joi.string().min(0)) as StringSchema;
		const getNumberSchema = () => (schema[key] ?? Joi.number()) as NumberSchema;
		const getDateSchema = () => (schema[key] ?? Joi.date()) as DateSchema;

		// 7. `_eq`: accept the value and its numeric / string twin, so `5` matches `'5'` and vice versa; values
		//    without a numeric twin (null, empty string, booleans) are compared as they are
		if (operator === '_eq') {
			let typecastedValue: string | number;

			if (typeof compareValue === 'number') {
				typecastedValue = String(compareValue);
			} else {
				typecastedValue = [null, '', true, false].includes(compareValue) ? NaN : Number(compareValue);
			}

			if (typeof typecastedValue === 'number' && isNaN(typecastedValue)) {
				schema[key] = getAnySchema().equal(compareValue);
			} else {
				schema[key] = getAnySchema().equal(compareValue, typecastedValue);
			}
		}

		// 8. `_neq`: the same twin logic, forbidding both forms
		if (operator === '_neq') {
			let typecastedValue: string | number;

			if (typeof compareValue === 'number') {
				typecastedValue = String(compareValue);
			} else {
				typecastedValue = [null, '', true, false].includes(compareValue) ? NaN : Number(compareValue);
			}

			if (typeof typecastedValue === 'number' && isNaN(typecastedValue)) {
				schema[key] = getAnySchema().not(compareValue);
			} else {
				schema[key] = getAnySchema().not(compareValue, typecastedValue);
			}
		}

		// 9. Substring operators: a non-string compare value cannot match anything, so the rule becomes
		//    {@link never}, which fails for any present value; a string is checked on the value itself or on any item of
		//    an array value; the `_ncontains` array branch stops at its first forbidden item, because several
		//    `array.excludes` reports would make the alternatives wrap everything into one `alternatives.match` error that
		//    cannot be mapped back to the operator
		if (operator === '_contains') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = Joi.alternatives().try(
					getStringSchema().contains(compareValue),
					Joi.array().items(getStringSchema().contains(compareValue).required(), Joi.any()),
				);
			}
		}

		if (operator === '_icontains') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = Joi.alternatives().try(
					getStringSchema().icontains(compareValue),
					Joi.array().items(getStringSchema().icontains(compareValue).required(), Joi.any()),
				);
			}
		}

		if (operator === '_ncontains') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = Joi.alternatives().try(
					getStringSchema().ncontains(compareValue),
					Joi.array().items(getStringSchema().contains(compareValue).forbidden()).prefs({ abortEarly: true }),
				);
			}
		}

		// 10. Prefix / suffix operators are rules of the extended Joi named after the operator, so the error carries the
		//     operator and the original substring; a non-string compare value cannot match anything, as in step 9
		if (operator === '_starts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = getStringSchema().starts_with(compareValue);
			}
		}

		if (operator === '_nstarts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = getStringSchema().nstarts_with(compareValue);
			}
		}

		if (operator === '_istarts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = getStringSchema().istarts_with(compareValue);
			}
		}

		if (operator === '_nistarts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = getStringSchema().nistarts_with(compareValue);
			}
		}

		if (operator === '_ends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = getStringSchema().ends_with(compareValue);
			}
		}

		if (operator === '_nends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = getStringSchema().nends_with(compareValue);
			}
		}

		if (operator === '_iends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = getStringSchema().iends_with(compareValue);
			}
		}

		if (operator === '_niends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = never();
			} else {
				schema[key] = getStringSchema().niends_with(compareValue);
			}
		}

		// 11. List membership maps straight onto Joi's allow / deny lists. A string compare value is spread into
		//     single characters and a non-empty array into its entries — the string spread is intentional,
		//     documented behaviour. Anything that is neither (an empty list, a number, `null`, …) cannot hold compare
		//     values: `_in` becomes the never-validating rule {@link never}, since a list of nothing allows nothing,
		//     and `_nin` becomes a no-op `any`, since forbidding nothing passes everything — the vacuous truth, stated
		//     here so it reads on purpose
		if (operator === '_in') {
			schema[key] =
				typeof compareValue === 'string' || (Array.isArray(compareValue) && compareValue.length > 0)
					? getAnySchema().equal(...(compareValue as (string | number)[]))
					: never();
		}

		if (operator === '_nin') {
			schema[key] =
				typeof compareValue === 'string' || (Array.isArray(compareValue) && compareValue.length > 0)
					? getAnySchema().not(...(compareValue as (string | number)[]))
					: Joi.any();
		}

		// 12. Range operators: a value that is a `Date` or does not parse as a number is compared as a date, so
		//     `'2024-01-01'` and `'18'` both work without the caller declaring the type. A string bound that is
		//     neither numeric nor a valid date can never be reached by a real value, so the rule degrades to the
		//     never-validating schema the malformed compare values get, instead of Joi throwing an assert at
		//     schema-build time: the payload under validation is not at fault for a bad filter
		if (operator === '_gt') {
			const isDate = compareValue instanceof Date || Number.isNaN(Number(compareValue));

			if (isDate && typeof compareValue === 'string' && Number.isNaN(Date.parse(compareValue))) {
				schema[key] = never();
			} else if (isDate) {
				schema[key] = getDateSchema().greater(compareValue as string | Date);
			} else {
				schema[key] = getNumberSchema().greater(Number(compareValue));
			}
		}

		if (operator === '_gte') {
			const isDate = compareValue instanceof Date || Number.isNaN(Number(compareValue));

			if (isDate && typeof compareValue === 'string' && Number.isNaN(Date.parse(compareValue))) {
				schema[key] = never();
			} else if (isDate) {
				schema[key] = getDateSchema().min(compareValue as string | Date);
			} else {
				schema[key] = getNumberSchema().min(Number(compareValue));
			}
		}

		if (operator === '_lt') {
			const isDate = compareValue instanceof Date || Number.isNaN(Number(compareValue));

			if (isDate && typeof compareValue === 'string' && Number.isNaN(Date.parse(compareValue))) {
				schema[key] = never();
			} else if (isDate) {
				schema[key] = getDateSchema().less(compareValue as string | Date);
			} else {
				schema[key] = getNumberSchema().less(Number(compareValue));
			}
		}

		if (operator === '_lte') {
			const isDate = compareValue instanceof Date || Number.isNaN(Number(compareValue));

			if (isDate && typeof compareValue === 'string' && Number.isNaN(Date.parse(compareValue))) {
				schema[key] = never();
			} else if (isDate) {
				schema[key] = getDateSchema().max(compareValue as string | Date);
			} else {
				schema[key] = getNumberSchema().max(Number(compareValue));
			}
		}

		// 13. Null and empty checks are allow / deny lists with a single entry
		if (operator === '_null') {
			schema[key] = getAnySchema().valid(null);
		}

		if (operator === '_nnull') {
			schema[key] = getAnySchema().invalid(null);
		}

		if (operator === '_empty') {
			schema[key] = getAnySchema().valid('');
		}

		if (operator === '_nempty') {
			schema[key] = getAnySchema().invalid('');
		}

		// 14. `_between` needs exactly two bounds: a pair of safe numbers builds the numeric range, a pair of dates
		//     the date range. Anything else — a non-array, fewer or more bounds, unsafe numbers, unparseable strings —
		//     cannot describe a range the payload could satisfy, so the rule becomes {@link never}, which fails for
		//     any present value, as with the malformed compare values above
		if (operator === '_between') {
			if (isSafeNumberPair(compareValue)) {
				const values = compareValue as [number, number];

				schema[key] = getNumberSchema().min(Number(values[0])).max(Number(values[1]));
			} else if (isDatePair(compareValue)) {
				const values = compareValue as [string | Date, string | Date];

				schema[key] = getDateSchema().min(values[0]).max(values[1]);
			} else {
				schema[key] = never();
			}
		}

		// 15. `_nbetween` is the complement of the range: below the low bound or above the high bound. Joi ANDs the
		//     rules of one schema, so "or" needs two alternatives; the bounds classify exactly like `_between` above
		//     and anything that is not a usable pair degrades the same way
		if (operator === '_nbetween') {
			if (isSafeNumberPair(compareValue)) {
				const values = compareValue as [number, number];

				schema[key] = Joi.alternatives().try(
					getNumberSchema().less(Number(values[0])),
					getNumberSchema().greater(Number(values[1])),
				);
			} else if (isDatePair(compareValue)) {
				const values = compareValue as [string | Date, string | Date];

				schema[key] = Joi.alternatives().try(getDateSchema().less(values[0]), getDateSchema().greater(values[1]));
			} else {
				schema[key] = never();
			}
		}

		// 16. `_submitted` only asks for the field to be present, whatever its value
		if (operator === '_submitted') {
			schema[key] = getAnySchema().required();
		}

		// 17. `_regex` accepts the pattern bare or wrapped in slashes; the string base of step 6 already lets an empty
		//     string reach the pattern
		if (operator === '_regex') {
			if (compareValue === null || compareValue === undefined) {
				schema[key] = never();
			} else {
				const wrapped =
					typeof compareValue === 'string' ? compareValue.startsWith('/') && compareValue.endsWith('/') : false;

				// 18. A pattern that does not compile can never be matched by a real value, so the rule degrades to
				//     {@link never} — which fails for any present value, like the malformed compare values above — instead
				//     of throwing a `SyntaxError` out of schema building: the payload under validation is not at fault
				//     for a bad filter
				let pattern: RegExp | null;

				try {
					pattern = new RegExp(wrapped ? compareValue.slice(1, -1) : compareValue);
				} catch {
					// The pattern does not compile; `null` degrades the rule below to never-validating
					pattern = null;
				}

				schema[key] = pattern !== null ? getStringSchema().regex(pattern) : never();
			}
		}
	}

	// 19. An operator this function does not know leaves the field unconstrained rather than failing the payload
	schema[key] = schema[key] ?? Joi.any();

	// 20. Presence is opt-in, so a filter can describe a partial update without every field being sent
	if (options.requireAll) {
		schema[key] = schema[key]!.required();
	}

	return Joi.object(schema).unknown();
}
