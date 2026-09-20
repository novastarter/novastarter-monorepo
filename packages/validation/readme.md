# `@novastarter/validation`

Validate a payload against filter rules and get structured per-field errors back.

## Installation

```
pnpm add @novastarter/validation
```

## Usage

```ts
import { validatePayload } from '@novastarter/validation';

const rules = {
	_and: [{ age: { _gte: 18 } }, { email: { _contains: '@' } }, { role: { _in: ['admin', 'editor'] } }],
};

const errors = validatePayload(rules, {
	age: 3,
	email: 'nope',
	role: 'admin',
});

errors.length; // 2
errors[0].message; // 'Validation failed for field "age". Value has to be greater than or equal to "18".'
errors[0].extensions; // { field: 'age', path: [], type: 'gte', valid: 18 }
errors[1].extensions; // { field: 'email', path: [], type: 'contains', substring: '@' }
```

Every error is a `NovastarterError` with `code: 'FAILED_VALIDATION'` and `status: 400`, so a transport layer can throw
the array as is and map it to a response.

Fields the rules mention but the payload lacks pass by default, which suits partial updates. `requireAll` fails them
instead:

```ts
validatePayload({ name: { _nempty: true } }, {}, { requireAll: true });
// => [FailedValidationError { extensions: { field: 'name', path: [], type: 'required' } }]
```

Nested objects are reached by nesting the filter; the keys below the field land in `path`:

```ts
validatePayload({ author: { name: { _eq: 'Ada' } } }, { author: { name: 'Bob' } });
// => [FailedValidationError { extensions: { field: 'author', path: ['name'], type: 'eq', valid: 'Ada' } }]
```

`_or` reports the errors of its members only when none of them passes.

### Operators

`_eq`, `_neq`, `_lt`, `_lte`, `_gt`, `_gte`, `_in`, `_nin`, `_null`, `_nnull`, `_empty`, `_nempty`, `_between`,
`_nbetween`, `_contains`, `_ncontains`, `_icontains`, `_starts_with`, `_nstarts_with`, `_istarts_with`,
`_nistarts_with`, `_ends_with`, `_nends_with`, `_iends_with`, `_niends_with`, `_regex`, `_submitted`.

Range operators compare as numbers when the compared value parses as one and as dates otherwise. `_regex` takes the
pattern bare (`^[a-z]+$`) or wrapped in slashes (`/^[a-z]+$/`). The `_contains` family also accepts an array value and
checks its items.

### Building errors by hand

Checks that are not expressible as a filter can still produce the same error:

```ts
import { FailedValidationError, joiValidationErrorItemToErrorExtensions } from '@novastarter/validation';

throw new FailedValidationError({
	field: 'email',
	path: [],
	type: 'email',
});

// or from a Joi detail, when running Joi yourself
const { error } = schema.validate(payload, { abortEarly: false });

if (error) {
	throw error.details.map((detail) => new FailedValidationError(joiValidationErrorItemToErrorExtensions(detail)));
}
```

`generateJoi()` and the extended `Joi` instance (with `contains`, `icontains`, `ncontains` string rules) are exported
for composing schemas of your own.

## zod

Schemas written in zod report the same shape: `zodErrorToErrorExtensions(error)` turns a `ZodError` into one
`FailedValidationErrorExtensions` per issue — bounds onto `gt` / `gte` / `lt` / `lte`, an enum onto `in`, a pattern onto
`regex`, a missing or mistyped value onto `required` — so a job payload, a request body and a filter rule are all
answered alike:

```ts
import { zodErrorToErrorExtensions } from '@novastarter/validation';
import { z } from 'zod';

const result = z.object({ count: z.number().min(1) }).safeParse({ count: 0 });

if (!result.success) {
	zodErrorToErrorExtensions(result.error);
	// => [{ field: 'count', path: [], type: 'gte', valid: 1 }]
}
```
