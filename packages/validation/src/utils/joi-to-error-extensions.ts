import type { ValidationErrorItem } from 'joi';
import type { FailedValidationErrorExtensions } from '../errors/failed-validation.js';

/**
 * Rules of the extended Joi for the contains family, matched on the whole rule name.
 *
 * `ncontains` and `icontains` both literally end with `contains`, so a suffix match reports all three as `contains`;
 * the name is compared whole, as the affix family below does.
 *
 * @internal
 */
const substringRules: ReadonlySet<string> = new Set(['contains', 'icontains', 'ncontains']);

/**
 * Rules of the extended Joi whose name is the operator itself and whose context carries the compared `substring`.
 *
 * These are the prefix / suffix family; the contains family is matched separately above.
 *
 * @internal
 */
const affixRules: ReadonlySet<string> = new Set([
	'starts_with',
	'nstarts_with',
	'istarts_with',
	'nistarts_with',
	'ends_with',
	'nends_with',
	'iends_with',
	'niends_with',
]);

/**
 * Collapse a Joi allow / deny list to its distinct entries, treating a number and its text form as one.
 *
 * `generateJoi` builds `_eq` / `_neq` as the value plus its numeric / string twin (`18` and `'18'`), so a list of
 * two entries is not necessarily an `_in`; the twin collapses to one entry while a genuine list keeps its size.
 *
 * @param values - `context.valids` or `context.invalids` of a Joi detail.
 * @returns Number of distinct entries once numeric twins are merged.
 * @internal
 */
const distinctCount = (values: unknown[]): number => {
	// 1. Only numbers are stringified: `null` and `'null'`, or `true` and `'true'`, stay distinct because
	//    `generateJoi` gives no twin to those
	return new Set(values.map((value) => (typeof value === 'number' ? String(value) : value))).size;
};

/**
 * A compared value as the extensions shape can carry it: numbers and strings only.
 *
 * Matches the zod converter's `comparable`, so both converters report the same value for the same rule: booleans
 * (an `_eq: true` is built as the boolean itself) and other non-string / non-number values are stringified rather
 * than dropped, so the client still sees what the field was compared against.
 *
 * @param value - A value out of a Joi `valids` / `invalids` list.
 * @returns The value itself when it is a number or a string, its text otherwise.
 * @internal
 */
const comparable = (value: unknown): string | number => {
	// 1. `String` covers booleans, bigints and `null` alike, mirroring the zod side
	return typeof value === 'number' || typeof value === 'string' ? value : String(value);
};

/**
 * A range bound as the extensions shape can carry it, with date bounds normalised.
 *
 * Joi puts the `Date` object itself into `context.limit` for `date.min` / `date.max` / `date.greater` /
 * `date.less`, while the extensions shape holds numbers and strings only: a raw `Date` would render with the
 * server's timezone in the message, so it is converted back to the ISO string the caller originally passed.
 *
 * @param limit - `context.limit` of a range rule detail.
 * @returns The ISO string for a date bound, otherwise the value as {@link comparable} reports it.
 * @internal
 */
const rangeLimit = (limit: unknown): string | number => {
	// 1. A Date bound would render timezone-dependently via `String()`, so it is normalised to its ISO form
	if (limit instanceof Date) return limit.toISOString();

	// 2. Everything else is a number or a string already, or is stringified like in `comparable`
	return comparable(limit);
};

/**
 * Translate one Joi validation detail into the extensions of a `FailedValidationError`.
 *
 * Joi names a failed rule `<type>.<rule>` (`number.greater`, `any.only`, `string.starts_with`), so the stock rules
 * are matched on their suffix regardless of the value type, while the extended string rules are matched on the whole
 * rule name, since `ncontains` and `icontains` end with `contains`. The compared value(s) come out of `context`,
 * whose keys differ per rule (`valids`, `invalids`, `limit`, `substring`), and are passed through
 * {@link comparable}, which stringifies booleans and other non-string / non-number values exactly like the zod
 * converter, so both report the same value for the same rule; range bounds pass through {@link rangeLimit}, which
 * normalises a date bound to its ISO string. A value of the wrong type maps to `required`, since
 * that is the closest thing the client can say about it. The substring rules are the ones registered on the extended
 * `Joi` of this package; a named pattern built by hand is not recognised.
 *
 * @param validationErrorItem - One entry of `ValidationError.details`.
 * @param path - Keys leading to the validated object, prepended to the item's own path for nested payloads.
 * @returns Extensions naming the field, the failed rule and what it compared against.
 * @throws Plain `Error` when the Joi rule is not one this package knows how to describe.
 * @example
 * ```ts
 * joiValidationErrorItemToErrorExtensions({
 * 	type: 'number.greater',
 * 	path: ['age'],
 * 	context: {
 * 		limit: 18,
 * 	},
 * });
 * // => { field: 'age', path: [], type: 'gt', valid: 18 }
 * ```
 */
export const joiValidationErrorItemToErrorExtensions = (
	validationErrorItem: ValidationErrorItem,
	path?: (string | number)[],
): FailedValidationErrorExtensions => {
	// 1. The first path segment is the field; the rest is where the value sits inside it
	const extensions: Partial<FailedValidationErrorExtensions> = {
		field: validationErrorItem.path[0] as string,
		path: [...(path ?? []), ...validationErrorItem.path.slice(1)],
	};

	const joiType = validationErrorItem.type;

	// 2. `.only` covers eq, in, null and empty: one allowed value, or a list of them. The list is counted with numeric
	//    twins merged, so `_eq: 18` (built as `[18, '18']`) reads as `eq` with the caller's value, not as `in`; the
	//    reported values pass through `comparable`, so a boolean compares as `'true'` / `'false'` like on the zod side
	if (joiType.endsWith('only')) {
		const valids: unknown[] = validationErrorItem.context?.['valids'] ?? [];

		if (distinctCount(valids) > 1) {
			extensions.type = 'in';
			extensions.valid = valids.map(comparable);
		} else {
			const valid = valids[0];

			if (valid === null) {
				extensions.type = 'null';
			} else if (valid === '') {
				extensions.type = 'empty';
			} else {
				extensions.type = 'eq';
				extensions.valid = comparable(valid);
			}
		}
	}

	// 3. `.invalid` is the mirror image: neq, nin, nnull and nempty, with the same twin handling and the same
	//    `comparable` normalisation as step 2
	if (joiType.endsWith('invalid')) {
		const invalids: unknown[] = validationErrorItem.context?.['invalids'] ?? [];

		if (distinctCount(invalids) > 1) {
			extensions.type = 'nin';
			extensions.invalid = invalids.map(comparable);
		} else {
			const invalid = invalids[0];

			if (invalid === null) {
				extensions.type = 'nnull';
			} else if (invalid === '') {
				extensions.type = 'nempty';
			} else {
				extensions.type = 'neq';
				extensions.invalid = comparable(invalid);
			}
		}
	}

	// 4. Range rules; Joi calls the inclusive bounds min / max and the exclusive ones greater / less. The bound is
	//    normalised through `rangeLimit`, since a date bound arrives as a Date object
	if (joiType.endsWith('greater')) {
		extensions.type = 'gt';
		extensions.valid = rangeLimit(validationErrorItem.context?.['limit']);
	}

	if (joiType.endsWith('min')) {
		extensions.type = 'gte';
		extensions.valid = rangeLimit(validationErrorItem.context?.['limit']);
	}

	if (joiType.endsWith('less')) {
		extensions.type = 'lt';
		extensions.valid = rangeLimit(validationErrorItem.context?.['limit']);
	}

	if (joiType.endsWith('max')) {
		extensions.type = 'lte';
		extensions.valid = rangeLimit(validationErrorItem.context?.['limit']);
	}

	// 5. Substring rules of the extended Joi: the rule name is the operator and the substring is the original
	//    argument, straight from the rule context. The name is compared whole, since `ncontains` and `icontains` end
	//    with `contains` and would otherwise all report as `contains`
	const rule = joiType.slice(joiType.lastIndexOf('.') + 1);

	if (joiType.startsWith('string.') && substringRules.has(rule)) {
		extensions.type = rule as FailedValidationErrorExtensions['type'];
		extensions.substring = validationErrorItem.context?.['substring'];
	}

	// 6. Prefix / suffix rules of the extended Joi, same shape as the substring rules above
	if (joiType.startsWith('string.') && affixRules.has(rule)) {
		extensions.type = rule as FailedValidationErrorExtensions['type'];
		extensions.substring = validationErrorItem.context?.['substring'];
	}

	// 7. A missing value, or a value of the wrong base type, both read as "required" to the client
	if (joiType.endsWith('required') || joiType.endsWith('.base')) {
		extensions.type = 'required';
	}

	// 8. Joi's stock string type rejects `''` before any rule runs. `generateJoi` lifts that with `min(0)`, but a
	//    caller's own string schema may not, and the rejection means exactly "must not be empty"
	if (joiType === 'string.empty') {
		extensions.type = 'nempty';
	}

	// 9. The substring rules are built as string-or-array alternatives; a value of neither type fails both by type,
	//    which is the same situation as a wrong base type above
	if (joiType === 'alternatives.types') {
		extensions.type = 'required';
	}

	// 10. Array forms of the substring rules: no item contained the substring, or an item contained the forbidden one.
	//     Joi does not hand the substring back from these rules, so only the operator is reported
	if (joiType === 'array.includesRequiredUnknowns') {
		extensions.type = 'contains';
	}

	if (joiType === 'array.excludes') {
		extensions.type = 'ncontains';
	}

	// 11. A bare pattern is the `_regex` rule; the pattern is reported, so the client can show what the value had to
	//     match — the same `invalid` meaning the zod converter gives a regex failure
	if (joiType.endsWith('.pattern.base')) {
		extensions.type = 'regex';
		extensions.invalid = String(validationErrorItem.context?.['regex']);
	}

	// 12. Outside the safe integer range, or infinite: neither is a number the client can act on, and Joi rejects
	//     `Infinity` with a rule of its own before any range check runs
	if (joiType === 'number.unsafe' || joiType === 'number.infinity') {
		extensions.type = 'unsafe';
	}

	// 13. Anything else is a rule `generateJoi` never emits; failing loudly beats a message without a type
	if (!extensions.type) {
		throw new Error(`Couldn't extract validation error type from Joi validation error item`);
	}

	return extensions as FailedValidationErrorExtensions;
};
