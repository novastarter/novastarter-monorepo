/**
 * Comparison operators a filter rule can use, without the leading underscore.
 *
 * These are the operators a storage layer can evaluate on its own; `@novastarter/validation` also evaluates them on
 * a payload in memory. `between` / `nbetween` take a two-element array, `in` / `nin` a list, the rest a single value.
 */
export type FilterOperator =
	| 'eq'
	| 'neq'
	| 'lt'
	| 'lte'
	| 'gt'
	| 'gte'
	| 'in'
	| 'nin'
	| 'null'
	| 'nnull'
	| 'contains'
	| 'ncontains'
	| 'icontains'
	| 'between'
	| 'nbetween'
	| 'empty'
	| 'nempty';

/**
 * Every operator a client may send, i.e. {@link FilterOperator} plus the string-pattern operators.
 *
 * The extra operators (`starts_with`, `ends_with`, their negated and case-insensitive forms, `regex`) are rewritten
 * to patterns before reaching a storage layer, which is why they are kept apart from {@link FilterOperator}.
 */
export type ClientFilterOperator =
	| FilterOperator
	| 'starts_with'
	| 'nstarts_with'
	| 'istarts_with'
	| 'nistarts_with'
	| 'ends_with'
	| 'nends_with'
	| 'iends_with'
	| 'niends_with'
	| 'regex';

/**
 * A complete filter: either a logical group of filters or a rule on a field.
 *
 * @example
 * ```ts
 * const filter: Filter = {
 * 	_and: [{ status: { _eq: 'published' } }, { _or: [{ views: { _gte: 100 } }, { featured: { _eq: true } }] }],
 * };
 * ```
 */
export type Filter = LogicalFilter | FieldFilter;

/**
 * Group of filters of which at least one must match.
 */
export type LogicalFilterOR = { _or: Filter[] };

/**
 * Group of filters that must all match.
 */
export type LogicalFilterAND = { _and: Filter[] };

/**
 * Either logical group. A level holds one `_and` or one `_or`, never both.
 */
export type LogicalFilter = LogicalFilterOR | LogicalFilterAND;

/**
 * Rule keyed by field name.
 *
 * The value is an operator object, or another {@link FieldFilter} to reach into a nested object, so
 * `{ author: { name: { _eq: 'Ada' } } }` checks `payload.author.name`.
 */
export type FieldFilter = {
	[field: string]: FieldFilterOperator | FieldValidationOperator | FieldFilter;
};

/**
 * Operator object of a field rule; one key, the underscore-prefixed {@link ClientFilterOperator}.
 *
 * Numbers and dates for `_lt` / `_gt` and friends may be passed as strings; the evaluating side casts them. The
 * `_null`, `_nnull`, `_empty` and `_nempty` flags take a boolean, which is only there to make the rule an object.
 */
export type FieldFilterOperator = {
	_eq?: string | number | boolean | null;
	_neq?: string | number | boolean | null;
	_lt?: string | number;
	_lte?: string | number;
	_gt?: string | number;
	_gte?: string | number;
	_in?: (string | number)[];
	_nin?: (string | number)[];
	_null?: boolean;
	_nnull?: boolean;
	_contains?: string;
	_ncontains?: string;
	_icontains?: string;
	_starts_with?: string;
	_nstarts_with?: string;
	_istarts_with?: string;
	_nistarts_with?: string;
	_ends_with?: string;
	_nends_with?: string;
	_iends_with?: string;
	_niends_with?: string;
	_between?: (string | number)[];
	_nbetween?: (string | number)[];
	_empty?: boolean;
	_nempty?: boolean;
};

/**
 * Operators that only make sense when validating a payload, not when querying storage.
 *
 * `_submitted` requires the field to be present at all; `_regex` matches the value against a pattern, given either
 * bare (`^[a-z]+$`) or wrapped in slashes (`/^[a-z]+$/`).
 */
export type FieldValidationOperator = {
	_submitted?: boolean;
	_regex?: string;
};
