import type { ValidationErrorItem } from 'joi';
import type { FailedValidationErrorExtensions } from '../errors/failed-validation.js';

/**
 * Translate one Joi validation detail into the extensions of a `FailedValidationError`.
 *
 * Joi names a failed rule `<type>.<rule>` (`number.greater`, `any.only`, `string.pattern.base`), so the rule is
 * matched on its suffix regardless of the value type. The compared value(s) come out of `context`, whose keys
 * differ per rule (`valids`, `invalids`, `limit`, `substring`, `regex`). A value of the wrong type maps to
 * `required`, since that is the closest thing the client can say about it.
 *
 * @param validationErrorItem - One entry of `ValidationError.details`.
 * @param path - Keys leading to the validated object, prepended to the item's own path for nested payloads.
 * @returns Extensions naming the field, the failed rule and what it compared against.
 * @throws Plain `Error` when the Joi rule is not one this package knows how to describe.
 * @example
 * ```ts
 * joiValidationErrorItemToErrorExtensions({ type: 'number.greater', path: ['age'], context: { limit: 18 } });
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

	// 2. `.only` covers eq, in, null and empty: one allowed value, or a list of them
	if (joiType.endsWith('only')) {
		if (validationErrorItem.context?.['valids'].length > 1) {
			extensions.type = 'in';
			extensions.valid = validationErrorItem.context?.['valids'];
		} else {
			const valid = validationErrorItem.context?.['valids'][0];

			if (valid === null) {
				extensions.type = 'null';
			} else if (valid === '') {
				extensions.type = 'empty';
			} else {
				extensions.type = 'eq';
				extensions.valid = valid;
			}
		}
	}

	// 3. `.invalid` is the mirror image: neq, nin, nnull and nempty
	if (joiType.endsWith('invalid')) {
		if (validationErrorItem.context?.['invalids'].length > 1) {
			extensions.type = 'nin';
			extensions.invalid = validationErrorItem.context?.['invalids'];
		} else {
			const invalid = validationErrorItem.context?.['invalids'][0];

			if (invalid === null) {
				extensions.type = 'nnull';
			} else if (invalid === '') {
				extensions.type = 'nempty';
			} else {
				extensions.type = 'neq';
				extensions.invalid = invalid;
			}
		}
	}

	// 4. Range rules; Joi calls the inclusive bounds min / max and the exclusive ones greater / less
	if (joiType.endsWith('greater')) {
		extensions.type = 'gt';
		extensions.valid = validationErrorItem.context?.['limit'];
	}

	if (joiType.endsWith('min')) {
		extensions.type = 'gte';
		extensions.valid = validationErrorItem.context?.['limit'];
	}

	if (joiType.endsWith('less')) {
		extensions.type = 'lt';
		extensions.valid = validationErrorItem.context?.['limit'];
	}

	if (joiType.endsWith('max')) {
		extensions.type = 'lte';
		extensions.valid = validationErrorItem.context?.['limit'];
	}

	// 5. Substring rules added by the extended Joi in `generateJoi`; `ncontains` also ends with `contains`, so it is
	//    checked second and wins
	if (joiType.endsWith('contains')) {
		extensions.type = 'contains';
		extensions.substring = validationErrorItem.context?.['substring'];
	}

	if (joiType.endsWith('ncontains')) {
		extensions.type = 'ncontains';
		extensions.substring = validationErrorItem.context?.['substring'];
	}

	// 6. A missing value, or a value of the wrong base type, both read as "required" to the client
	if (joiType.endsWith('required') || joiType.endsWith('.base')) {
		extensions.type = 'required';
	}

	// 7. The substring rules are built as string-or-array alternatives; a value of neither type fails both by type,
	//    which is the same situation as a wrong base type above
	if (joiType === 'alternatives.types') {
		extensions.type = 'required';
	}

	// 8. Array forms of the substring rules: no item contained the substring, or an item contained the forbidden one.
	//    Joi does not hand the substring back from these rules, so only the operator is reported
	if (joiType === 'array.includesRequiredUnknowns') {
		extensions.type = 'contains';
	}

	if (joiType === 'array.excludes') {
		extensions.type = 'ncontains';
	}

	// 9. A bare pattern is the `_regex` rule; the value is passed on so the client can show what was rejected
	if (joiType.endsWith('.pattern.base')) {
		extensions.type = 'regex';
		extensions.invalid = validationErrorItem.context?.value;
	}

	// 10. Outside the safe integer range
	if (joiType === 'number.unsafe') {
		extensions.type = 'unsafe';
	}

	// 11. Named patterns are the starts_with / ends_with family; the operator is the pattern name and the substring is
	//    cut back out of the regex source, since Joi does not keep the original argument
	if (joiType.endsWith('.pattern.name') || joiType.endsWith('.pattern.invert.name')) {
		extensions.type = validationErrorItem.context?.['name'];
		const regex = validationErrorItem.context?.['regex']?.toString();

		switch (extensions.type) {
			case 'starts_with':
			case 'nstarts_with':
			case 'istarts_with':
			case 'nistarts_with':
				extensions.substring = regex.substring(2, regex.lastIndexOf('/') - 2);
				break;
			case 'ends_with':
			case 'nends_with':
			case 'iends_with':
			case 'niends_with':
				extensions.substring = regex.substring(3, regex.lastIndexOf('/') - 1);
				break;
		}
	}

	// 12. Anything else is a rule `generateJoi` never emits; failing loudly beats a message without a type
	if (!extensions.type) {
		throw new Error(`Couldn't extract validation error type from Joi validation error item`);
	}

	return extensions as FailedValidationErrorExtensions;
};
