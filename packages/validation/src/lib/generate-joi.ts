import type { FieldFilter } from '@novastarter/types';
import type { AnySchema, StringSchema as BaseStringSchema, DateSchema, NumberSchema } from 'joi';
import BaseJoi from 'joi';
import { escapeRegExp, merge } from 'lodash-es';

/**
 * Joi string schema with the substring rules added by {@link Joi}.
 *
 * Joi's own string schema has no "contains" rule, so the three are registered as an extension and typed here.
 */
export interface StringSchema extends BaseStringSchema {
	/** Require the string to contain `substring`, case-sensitive. */
	contains(substring: string): this;
	/** Require the string to contain `substring`, ignoring case. */
	icontains(substring: string): this;
	/** Forbid the string from containing `substring`, case-sensitive. */
	ncontains(substring: string): this;
}

/**
 * Joi instance used by the package: the stock one with `contains`, `icontains` and `ncontains` string rules.
 *
 * The rule names surface in `ValidationErrorItem.type` as `string.contains` etc., which is what
 * `joiValidationErrorItemToErrorExtensions` matches on. Use this instance, not `joi` directly, when composing with
 * schemas from {@link generateJoi}.
 */
export const Joi: typeof BaseJoi = BaseJoi.extend({
	type: 'string',
	base: BaseJoi.string(),
	messages: {
		'string.contains': '{{#label}} must contain [{{#substring}}]',
		'string.icontains': '{{#label}} must contain case insensitive [{{#substring}}]',
		'string.ncontains': "{{#label}} can't contain [{{#substring}}]",
	},
	rules: {
		contains: {
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
			 * @param substring - Text the value must contain.
			 * @returns The schema with the rule added.
			 */
			method(substring) {
				return this.$_addRule({ name: 'contains', args: { substring } });
			},
			/**
			 * Check the value.
			 *
			 * @param value - String under validation.
			 * @param helpers - Joi rule helpers, used to report the error.
			 * @param args - Rule arguments; only `substring`.
			 * @returns The value when it passes, otherwise a Joi error report.
			 */
			validate(value, helpers, { substring }) {
				// 1. Report with the substring in context, so the error can name what was missing
				if (value.includes(substring) === false) {
					return helpers.error('string.contains', { substring });
				}

				return value;
			},
		},
		icontains: {
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
			 * @param substring - Text the value must contain, in any case.
			 * @returns The schema with the rule added.
			 */
			method(substring) {
				return this.$_addRule({ name: 'icontains', args: { substring } });
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
				// 1. Lower-case both sides; the original substring is kept for the error context
				if (value.toLowerCase().includes(substring.toLowerCase()) === false) {
					return helpers.error('string.icontains', { substring });
				}

				return value;
			},
		},
		ncontains: {
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
			 * @param substring - Text the value must not contain.
			 * @returns The schema with the rule added.
			 */
			method(substring) {
				return this.$_addRule({ name: 'ncontains', args: { substring } });
			},
			/**
			 * Check the value.
			 *
			 * @param value - String under validation.
			 * @param helpers - Joi rule helpers, used to report the error.
			 * @param args - Rule arguments; only `substring`.
			 * @returns The value when it passes, otherwise a Joi error report.
			 */
			validate(value, helpers, { substring }) {
				// 1. The presence of the substring is the failure here
				if (value.includes(substring) === true) {
					return helpers.error('string.ncontains', { substring });
				}

				return value;
			},
		},
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

		// 5. Lazily pick the base schema per type, so a previously built schema for the key is extended, not replaced
		const getAnySchema = () => schema[key] ?? Joi.any();
		const getStringSchema = () => (schema[key] ?? Joi.string()) as StringSchema;
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

		// 9. Prefix / suffix operators become named patterns; the name is what the error converter reads back as the
		//    operator, `invert` flips the match for the negated forms and the `i` flag handles the case-insensitive ones
		if (operator === '_starts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().pattern(new RegExp(`^${escapeRegExp(compareValue)}.*`), {
					name: 'starts_with',
				});
			}
		}

		if (operator === '_nstarts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().pattern(new RegExp(`^${escapeRegExp(compareValue)}.*`), {
					name: 'nstarts_with',
					invert: true,
				});
			}
		}

		if (operator === '_istarts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().pattern(new RegExp(`^${escapeRegExp(compareValue)}.*`, 'i'), {
					name: 'istarts_with',
				});
			}
		}

		if (operator === '_nistarts_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().pattern(new RegExp(`^${escapeRegExp(compareValue)}.*`, 'i'), {
					name: 'nistarts_with',
					invert: true,
				});
			}
		}

		if (operator === '_ends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().pattern(new RegExp(`.*${escapeRegExp(compareValue)}$`), {
					name: 'ends_with',
				});
			}
		}

		if (operator === '_nends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().pattern(new RegExp(`.*${escapeRegExp(compareValue)}$`), {
					name: 'nends_with',
					invert: true,
				});
			}
		}

		if (operator === '_iends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().pattern(new RegExp(`.*${escapeRegExp(compareValue)}$`, 'i'), {
					name: 'iends_with',
				});
			}
		}

		if (operator === '_niends_with') {
			if (compareValue === null || compareValue === undefined || typeof compareValue !== 'string') {
				schema[key] = Joi.any().equal(true);
			} else {
				schema[key] = getStringSchema().pattern(new RegExp(`.*${escapeRegExp(compareValue)}$`, 'i'), {
					name: 'niends_with',
					invert: true,
				});
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

		// 13. `_between` is numeric only when both bounds are safe numbers; otherwise the bounds are read as dates.
		//     `_nbetween` is the complement, hence `less(low)` combined with `greater(high)`
		if (operator === '_between') {
			if (
				(compareValue as any).every((value: any) => {
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

		if (operator === '_nbetween') {
			if (
				(compareValue as any).every((value: any) => {
					const val = Number(value instanceof Date ? NaN : value);
					return !Number.isNaN(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER;
				})
			) {
				const values = compareValue as [number, number];
				schema[key] = getNumberSchema().less(Number(values[0])).greater(Number(values[1]));
			} else {
				const values = compareValue as [string, string];
				schema[key] = getDateSchema().less(values[0]).greater(values[1]);
			}
		}

		// 14. `_submitted` only asks for the field to be present, whatever its value
		if (operator === '_submitted') {
			schema[key] = getAnySchema().required();
		}

		// 15. `_regex` accepts the pattern bare or wrapped in slashes; `min(0)` lets an empty string reach the pattern
		//     instead of failing Joi's default non-empty string rule
		if (operator === '_regex') {
			if (compareValue === null || compareValue === undefined) {
				schema[key] = Joi.any().equal(true);
			} else {
				const wrapped =
					typeof compareValue === 'string' ? compareValue.startsWith('/') && compareValue.endsWith('/') : false;

				schema[key] = getStringSchema()
					.min(0)
					.regex(new RegExp(wrapped ? (compareValue as any).slice(1, -1) : compareValue));
			}
		}
	}

	// 16. An operator this function does not know leaves the field unconstrained rather than failing the payload
	schema[key] = schema[key] ?? Joi.any();

	// 17. Presence is opt-in, so a filter can describe a partial update without every field being sent
	if (options.requireAll) {
		schema[key] = schema[key]!.required();
	}

	return Joi.object(schema).unknown();
}
