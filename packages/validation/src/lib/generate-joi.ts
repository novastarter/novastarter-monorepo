import type { FieldFilter } from '@novastarter/types';
import type {
	AnySchema,
	StringSchema as BaseStringSchema,
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
 * Build a Joi schema from one field filter.
 *
 * The filter holds a single field key whose value is either an operator object (`{ _gte: 18 }`) or another field
 * filter for a nested object. Logical `_and` / `_or` groups are not handled here; `validatePayload` splits them
 * first. Every schema is an object schema that allows unknown keys, so a payload may carry fields the filter never
 * mentions.
 *
 * @param filter - Field filter with exactly one field key; `null` is treated as an empty filter.
 * @param options - Schema options merged over {@link defaults}.
 * @returns Object schema with a rule for the filter's field.
 * @throws Plain `Error` when the filter has no field key or the field has no rule.
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

	// 2. A filter describes exactly one field; anything else is a caller bug worth failing on
	const key = Object.keys(filter)[0];

	if (!key) {
		throw new Error(`[generateJoi] Filter doesn't contain field key. Passed filter: ${JSON.stringify(filter)}`);
	}

	const value = Object.values(filter)[0];

	if (!value) {
		throw new Error(`[generateJoi] Filter doesn't contain filter rule. Passed filter: ${JSON.stringify(filter)}`);
	}

	// 3. A value whose first key is not an operator is a nested field filter: recurse and nest the schema
	if (Object.keys(value)[0]?.startsWith('_') === false) {
		schema[key] = generateJoi(value as FieldFilter, options);
	} else {
		// 4. Otherwise the value is an operator object; only its first operator is applied
		const operator = Object.keys(value)[0];
		const compareValue = Object.values(value)[0];

		// 5. Lazily pick the base schema for the operator at hand. The schema map is built fresh on every call and only
		//    the first operator of the value applies, so `schema[key]` is always unset here; each operator composes its
		//    own schema for the key from the typed base. The string base gets `min(0)`, because Joi's stock string
		//    rejects `''` with `string.empty` before any rule runs; a form field left blank must reach the substring
		//    rule and fail (or pass) on that rule instead
		const getAnySchema = () => schema[key] ?? Joi.any();
		const getStringSchema = () => (schema[key] ?? Joi.string().min(0)) as StringSchema;
		const getNumberSchema = () => (schema[key] ?? Joi.number()) as NumberSchema;
		const getDateSchema = () => (schema[key] ?? Joi.date()) as DateSchema;

		// 6. `_eq`: accept the value and its numeric / string twin, so `5` matches `'5'` and vice versa; values
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

		// 7. `_neq`: the same twin logic, forbidding both forms
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

		// 8. Substring operators: a non-string compare value cannot match anything, so the rule becomes
		//    `equal(true)`, which fails for any real value; a string is checked on the value itself or on any item of
		//    an array value
		if (operator === '_contains') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = Joi.alternatives().try(
					getStringSchema().contains(compareValue),
					Joi.array().items(getStringSchema().contains(compareValue).required(), Joi.any()),
				);
			}
		}

		if (operator === '_icontains') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = Joi.alternatives().try(
					getStringSchema().icontains(compareValue),
					Joi.array().items(getStringSchema().icontains(compareValue).required(), Joi.any()),
				);
			}
		}

		if (operator === '_ncontains') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = Joi.alternatives().try(
					getStringSchema().ncontains(compareValue),
					Joi.array().items(getStringSchema().contains(compareValue).forbidden()),
				);
			}
		}

		// 9. Prefix / suffix operators are rules of the extended Joi named after the operator, so the error carries the
		//    operator and the original substring; a non-string compare value cannot match anything, as in step 8
		if (operator === '_starts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().starts_with(compareValue);
			}
		}

		if (operator === '_nstarts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().nstarts_with(compareValue);
			}
		}

		if (operator === '_istarts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().istarts_with(compareValue);
			}
		}

		if (operator === '_nistarts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().nistarts_with(compareValue);
			}
		}

		if (operator === '_ends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().ends_with(compareValue);
			}
		}

		if (operator === '_nends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().nends_with(compareValue);
			}
		}

		if (operator === '_iends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().iends_with(compareValue);
			}
		}

		if (operator === '_niends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().niends_with(compareValue);
			}
		}

		// 10. List membership maps straight onto Joi's allow / deny lists
		if (operator === '_in') {
			schema[key] = getAnySchema().equal(...(compareValue as (string | number)[]));
		}

		if (operator === '_nin') {
			schema[key] = getAnySchema().not(...(compareValue as (string | number)[]));
		}

		// 11. Range operators: a value that is a `Date` or does not parse as a number is compared as a date, so
		//     `'2024-01-01'` and `'18'` both work without the caller declaring the type
		if (operator === '_gt') {
			const isDate = compareValue instanceof Date || Number.isNaN(Number(compareValue));

			schema[key] = isDate
				? getDateSchema().greater(compareValue as string | Date)
				: getNumberSchema().greater(Number(compareValue));
		}

		if (operator === '_gte') {
			const isDate = compareValue instanceof Date || Number.isNaN(Number(compareValue));

			schema[key] = isDate
				? getDateSchema().min(compareValue as string | Date)
				: getNumberSchema().min(Number(compareValue));
		}

		if (operator === '_lt') {
			const isDate = compareValue instanceof Date || Number.isNaN(Number(compareValue));

			schema[key] = isDate
				? getDateSchema().less(compareValue as string | Date)
				: getNumberSchema().less(Number(compareValue));
		}

		if (operator === '_lte') {
			const isDate = compareValue instanceof Date || Number.isNaN(Number(compareValue));

			schema[key] = isDate
				? getDateSchema().max(compareValue as string | Date)
				: getNumberSchema().max(Number(compareValue));
		}

		// 12. Null and empty checks are allow / deny lists with a single entry
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

		// 13. `_between` is numeric only when the compare value is an array of safe numbers; otherwise array bounds are
		//     read as dates. A compare value that is not an array cannot hold two bounds, so the rule becomes
		//     `equal(true)`, which fails for any real value, as with the substring operators above
		if (operator === '_between') {
			if (Array.isArray(compareValue) === false) {
				schema[key] = Joi.any().equal(true);
			} else if (
				(compareValue as (string | number | Date)[]).every((value) => {
					const val = Number(value instanceof Date ? NaN : value);
					return !Number.isNaN(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER;
				})
			) {
				const values = compareValue as [number, number];
				schema[key] = getNumberSchema().min(Number(values[0])).max(Number(values[1]));
			} else {
				const values = compareValue as [string, string];
				schema[key] = getDateSchema().min(values[0]).max(values[1]);
			}
		}

		// 14. `_nbetween` is the complement of the range: below the low bound or above the high bound. Joi ANDs the
		//     rules of one schema, so "or" needs two alternatives; a non-array compare value fails like the one above
		if (operator === '_nbetween') {
			if (Array.isArray(compareValue) === false) {
				schema[key] = Joi.any().equal(true);
			} else if (
				(compareValue as (string | number | Date)[]).every((value) => {
					const val = Number(value instanceof Date ? NaN : value);
					return !Number.isNaN(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER;
				})
			) {
				const values = compareValue as [number, number];

				schema[key] = Joi.alternatives().try(
					getNumberSchema().less(Number(values[0])),
					getNumberSchema().greater(Number(values[1])),
				);
			} else {
				const values = compareValue as [string, string];
				schema[key] = Joi.alternatives().try(getDateSchema().less(values[0]), getDateSchema().greater(values[1]));
			}
		}

		// 15. `_submitted` only asks for the field to be present, whatever its value
		if (operator === '_submitted') {
			schema[key] = getAnySchema().required();
		}

		// 16. `_regex` accepts the pattern bare or wrapped in slashes; the string base of step 5 already lets an empty
		//     string reach the pattern
		if (operator === '_regex') {
			if (compareValue === null || compareValue === undefined) {
				schema[key] = Joi.any().equal(true);
			} else {
				const wrapped =
					typeof compareValue === 'string' ? compareValue.startsWith('/') && compareValue.endsWith('/') : false;

				schema[key] = getStringSchema().regex(new RegExp(wrapped ? (compareValue as any).slice(1, -1) : compareValue));
			}
		}
	}

	// 17. An operator this function does not know leaves the field unconstrained rather than failing the payload
	schema[key] = schema[key] ?? Joi.any();

	// 18. Presence is opt-in, so a filter can describe a partial update without every field being sent
	if (options.requireAll) {
		schema[key] = schema[key]!.required();
	}

	return Joi.object(schema).unknown();
}
