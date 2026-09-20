import type { FieldFilter, Filter } from '@novastarter/types';
import { flatten } from 'lodash-es';
import { FailedValidationError } from '../errors/failed-validation.js';
import { joiValidationErrorItemToErrorExtensions } from '../utils/joi-to-error-extensions.js';
import { generateJoi, type JoiOptions } from './generate-joi.js';

/**
 * Check a payload against filter rules and collect one error per failed rule.
 *
 * Logical groups are walked recursively: every member of an `_and` is checked and all their errors are collected;
 * for an `_or` the errors of the failing members are only reported when no member passes. A level holds a single
 * `_and` or `_or`. A field filter is turned into a Joi schema by {@link generateJoi} and validated with
 * `abortEarly: false`, so every failing rule of that field is reported, not just the first.
 *
 * @param filter - Rules to check: a logical group or a single field filter.
 * @param payload - Object under validation; fields the filter does not mention are ignored.
 * @param options - Passed on to {@link generateJoi}; `requireAll` fails missing fields instead of skipping them.
 * @returns Empty when the payload passes, otherwise one `FailedValidationError` per failed rule.
 * @example
 * ```ts
 * const errors = validatePayload({ _and: [{ age: { _gte: 18 } }, { email: { _contains: '@' } }] }, { age: 3 });
 *
 * errors[0]?.extensions; // { field: 'age', path: [], type: 'gte', valid: 18 }
 * ```
 */
export function validatePayload(
	filter: Filter,
	payload: Record<string, any>,
	options?: JoiOptions,
): InstanceType<typeof FailedValidationError>[] {
	const errors: InstanceType<typeof FailedValidationError>[] = [];

	// 1. `_and`: every member must pass, so the errors of all members are collected
	if (Object.keys(filter)[0] === '_and') {
		const subValidation = Object.values(filter)[0] as FieldFilter[];

		const nestedErrors = flatten<InstanceType<typeof FailedValidationError>>(
			subValidation.map((subObj: Record<string, any>) => {
				return validatePayload(subObj, payload, options);
			}),
		).filter((err?: InstanceType<typeof FailedValidationError>) => err);

		errors.push(...nestedErrors);
	} else if (Object.keys(filter)[0] === '_or') {
		// 2. `_or`: stop at the first passing member; the errors gathered so far are only surfaced when none passes,
		//    since the caller then needs to see why each branch was rejected
		const subValidation = Object.values(filter)[0] as FieldFilter[];

		const swallowErrors: InstanceType<typeof FailedValidationError>[] = [];

		const pass = subValidation.some((subObj: Record<string, any>) => {
			const nestedErrors = validatePayload(subObj, payload, options);

			if (nestedErrors.length > 0) {
				swallowErrors.push(...nestedErrors);
				return false;
			}

			return true;
		});

		if (!pass) {
			errors.push(...swallowErrors);
		}
	} else {
		// 3. Leaf: build the schema and run it; each Joi detail becomes one error with structured extensions, so the
		//    caller never sees Joi
		const schema = generateJoi(filter as FieldFilter, options);

		const { error } = schema.validate(payload, { abortEarly: false });

		if (error) {
			errors.push(
				...error.details.map((detail) => new FailedValidationError(joiValidationErrorItemToErrorExtensions(detail))),
			);
		}
	}

	return errors;
}
