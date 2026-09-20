import type { z } from 'zod';
import type { FailedValidationErrorExtensions } from '../errors/failed-validation.js';

/**
 * Translate the issues of a zod error into the extensions of `FailedValidationError`.
 *
 * The counterpart of `joiValidationErrorItemToErrorExtensions` for schemas written in zod: one entry per issue,
 * in the same shape the API answers with, so a job payload, a request body and a filter rule are all reported alike. Zod's codes map onto the filter operators where one fits — a bound to
 * `gt` / `gte` / `lt` / `lte`, an enum to `in` or `eq`, a pattern to `regex`, an address to `email` — a value of the
 * wrong type or missing altogether to `required`, like the Joi converter does, and everything else (a refinement, an
 * unknown key, a failed union) to `unsafe`, the catch-all of the shape.
 *
 * @param error - The error `schema.safeParse()` reported.
 * @returns Extensions naming the field, the path below it and the failed rule, one per issue.
 * @example
 * ```ts
 * const result = z.object({ count: z.number().min(1) }).safeParse({ count: 0 });
 *
 * zodErrorToErrorExtensions(result.error);
 * // => [{ field: 'count', path: [], type: 'gte', valid: 1 }]
 * ```
 */
export const zodErrorToErrorExtensions = (error: z.ZodError): FailedValidationErrorExtensions[] => {
	return error.issues.map((issue) => {
		// 1. The first path segment is the field; the rest is where the value sits inside it. An issue on the root of
		//    the payload has no field, which the empty string stands for
		const [field = '', ...path] = issue.path.map((segment) =>
			typeof segment === 'symbol' ? String(segment) : segment,
		);

		return { field: String(field), path, ...describeIssue(issue) };
	});
};

/**
 * The rule part of the extensions for one issue: `type` plus the value it compared against, when it has one.
 *
 * @param issue - One entry of `ZodError.issues`.
 * @returns The rule and its comparison value.
 * @internal
 */
const describeIssue = (issue: z.core.$ZodIssue): Omit<FailedValidationErrorExtensions, 'field' | 'path'> => {
	switch (issue.code) {
		// 1. A missing value and a value of the wrong type read the same to the caller: the field is not usable
		case 'invalid_type':
			return { type: 'required' };

		// 2. Bounds carry whether they are inclusive; bigints are stringified since the shape only holds numbers and
		//    strings
		case 'too_small':
			return { type: issue.inclusive ? 'gte' : 'gt', valid: comparable(issue.minimum) };

		case 'too_big':
			return { type: issue.inclusive ? 'lte' : 'lt', valid: comparable(issue.maximum) };

		// 3. String formats: the ones with an operator of their own keep it, the rest are reported as the pattern
		//    that failed
		case 'invalid_format':
			return describeFormat(issue);

		// 4. A literal or an enum: one allowed value, or a list of them
		case 'invalid_value': {
			const values = issue.values.map(comparable);

			return values.length > 1 ? { type: 'in', valid: values } : { type: 'eq', valid: values[0] ?? '' };
		}

		// 5. Refinements, unions, unknown keys and the like have no operator form
		default:
			return { type: 'unsafe' };
	}
};

/**
 * The rule for a failed string format.
 *
 * @param issue - An `invalid_format` issue.
 * @returns The rule and the text or pattern it compared against.
 * @internal
 */
const describeFormat = (
	issue: z.core.$ZodIssueInvalidStringFormat,
): Omit<FailedValidationErrorExtensions, 'field' | 'path'> => {
	switch (issue.format) {
		// 1. The formats the shape has an operator for keep it, with the text the value had to carry
		case 'email':
			return { type: 'email' };

		case 'starts_with':
			return { type: 'starts_with', substring: (issue as z.core.$ZodIssueStringStartsWith).prefix };

		case 'ends_with':
			return { type: 'ends_with', substring: (issue as z.core.$ZodIssueStringEndsWith).suffix };

		case 'includes':
			return { type: 'contains', substring: (issue as z.core.$ZodIssueStringIncludes).includes };

		// 2. Every other format — a UUID, a URL, a date, an explicit regex — is a pattern the value did not match;
		//    zod names it on the issue when it has one
		default:
			return { type: 'regex', invalid: issue.pattern ?? issue.format };
	}
};

/**
 * A comparison value as the shape can carry it: numbers and strings only.
 *
 * @param value - A bound or an allowed value of zod's.
 * @returns The value itself when it is a number or a string, its text otherwise.
 * @internal
 */
const comparable = (value: unknown): number | string => {
	// 1. Bigints, booleans and null are stringified rather than dropped, so the caller still sees what was expected
	return typeof value === 'number' || typeof value === 'string' ? value : String(value);
};
