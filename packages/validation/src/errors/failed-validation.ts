import { createError, type NovastarterErrorConstructor } from '@novastarter/errors';
import type { ClientFilterOperator } from '@novastarter/types';
import { toArray } from '@novastarter/utils';

/**
 * Details of one field that failed validation.
 *
 * `type` names the rule that failed; the optional members carry what the rule compared against, so a client can
 * render its own message instead of the one in `message`. Which optional members are present depends on `type`:
 * `valid` for `eq` / `lt` / `lte` / `gt` / `gte` / `in`, `invalid` for `neq` / `nin` / `regex`, `substring` for the
 * `contains` and `starts_with` / `ends_with` families.
 */
export interface FailedValidationErrorExtensions {
	/** Top-level key of the payload the failing value lives under. */
	field: string;
	/** Keys below `field` leading to the failing value; empty for a top-level field. */
	path: (string | number)[];
	/** Rule that failed: a filter operator, or one of the checks that have no operator form. */
	type: ClientFilterOperator | 'required' | 'email' | 'unsafe';
	/** Value(s) the field was expected to match. */
	valid?: number | string | (number | string)[];
	/** Value(s) or pattern the field was expected not to match: the forbidden value(s) for `neq` / `nin`, the pattern for `regex`. */
	invalid?: number | string | (number | string)[];
	/** Text the field was expected to contain, not contain, start with or end with. */
	substring?: string;
}

/**
 * Build the message of a {@link FailedValidationError} from its extensions.
 *
 * The message always names the field and its path, then adds a sentence about the failed rule when there is a
 * readable phrasing for it; rules without one (for example `between`) leave only the first sentence.
 *
 * @param extensions - Field, path, rule and the compared value(s).
 * @returns Message such as `Validation failed for field "age". Value has to be greater than "18".`
 */
export const messageConstructor = (extensions: FailedValidationErrorExtensions): string => {
	const atPath = extensions.path.length > 0 ? ` at "${extensions.path.join('.')}"` : '';
	let message = `Validation failed for field "${extensions.field}"${atPath}.`;

	if ('valid' in extensions) {
		switch (extensions.type) {
			case 'eq':
				message += ` Value has to be "${extensions.valid}".`;
				break;
			case 'lt':
				message += ` Value has to be less than "${extensions.valid}".`;
				break;
			case 'lte':
				message += ` Value has to be less than or equal to "${extensions.valid}".`;
				break;
			case 'gt':
				message += ` Value has to be greater than "${extensions.valid}".`;
				break;
			case 'gte':
				message += ` Value has to be greater than or equal to "${extensions.valid}".`;
				break;
			case 'in':
				// An empty list comes from a malformed rule that no value can satisfy; "one of ." would read as a typo
				message +=
					toArray(extensions.valid).length === 0
						? ' No value is allowed.'
						: ` Value has to be one of ${toArray(extensions.valid)
								.map((val) => `"${val}"`)
								.join(', ')}.`;

				break;
		}
	}

	if ('invalid' in extensions) {
		switch (extensions.type) {
			case 'neq':
				message += ` Value can't be "${extensions.invalid}".`;
				break;
			case 'nin':
				message += ` Value can't be one of ${toArray(extensions.invalid)
					.map((val) => `"${val}"`)
					.join(', ')}.`;

				break;
		}
	}

	// `icontains` reads the same as `contains`, and the case-insensitive affixes the same as their plain forms, since
	// the case is a detail the client renders on its own
	if ('substring' in extensions) {
		switch (extensions.type) {
			case 'contains':
			case 'icontains':
				message += ` Value has to contain "${extensions.substring}".`;
				break;
			case 'ncontains':
				message += ` Value can't contain "${extensions.substring}".`;
				break;
			case 'starts_with':
			case 'istarts_with':
				message += ` Value has to start with "${extensions.substring}".`;
				break;
			case 'nstarts_with':
			case 'nistarts_with':
				message += ` Value can't start with "${extensions.substring}".`;
				break;
			case 'ends_with':
			case 'iends_with':
				message += ` Value has to end with "${extensions.substring}".`;
				break;
			case 'nends_with':
			case 'niends_with':
				message += ` Value can't end with "${extensions.substring}".`;
				break;
		}
	}

	switch (extensions.type) {
		case 'null':
			message += ` Value has to be null.`;
			break;
		case 'nnull':
			message += ` Value can't be null.`;
			break;
		case 'empty':
			message += ` Value has to be empty.`;
			break;
		case 'nempty':
			message += ` Value can't be empty.`;
			break;
		case 'required':
			message += ` Value is required.`;
			break;
		case 'regex':
			message += ` Value doesn't have the correct format.`;
			break;
		case 'email':
			message += ` Value has to be a valid email address.`;
			break;
		case 'unsafe':
			message += ` Value is not valid.`;
			break;
	}

	return message;
};

/**
 * Error for one field that failed validation.
 *
 * Answers with HTTP 400 and carries {@link FailedValidationErrorExtensions}, so a transport layer can return the
 * failing field and rule as data next to the message. `validatePayload` produces one per failing rule; callers that
 * run their own checks (an e-mail format, a password policy) construct it directly.
 *
 * @example
 * ```ts
 * throw new FailedValidationError({
 * 	field: 'email',
 * 	path: [],
 * 	type: 'email',
 * });
 * ```
 */
export const FailedValidationError: NovastarterErrorConstructor<FailedValidationErrorExtensions> =
	createError<FailedValidationErrorExtensions>('FAILED_VALIDATION', messageConstructor, 400);
