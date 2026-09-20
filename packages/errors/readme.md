# `@novastarter/errors`

Create consistent error objects around the codebase.

## Installation

```
pnpm add @novastarter/errors
```

## Usage

Defining an error class and matching it:

```ts
import { createError, isNovastarterError } from '@novastarter/errors';

const InvalidThingError = createError<{ thing: string }>(
	'INVALID_THING',
	({ thing }) => `Thing "${thing}" is invalid.`,
	400,
);

try {
	throw new InvalidThingError({ thing: 'foo' });
} catch (error) {
	if (isNovastarterError(error, 'INVALID_THING')) {
		error.status; // 400
		error.extensions.thing; // 'foo'
	}
}
```

The classes of the kit:

```ts
import { ErrorCode, HitRateLimitError, InvalidPayloadError } from '@novastarter/errors';

throw new InvalidPayloadError({ reason: 'Field "email" is required' });
// message: 'Invalid payload. Field "email" is required.', code: 'INVALID_PAYLOAD', status: 400

throw new HitRateLimitError({
	limit: 10,
	reset: new Date(Date.now() + 5_000),
});
// message: 'Too many requests, retry after 5s.', code: 'REQUESTS_EXCEEDED', status: 429

ErrorCode.InvalidPayload; // 'INVALID_PAYLOAD' — the codes, for matching
```

`createError(code, message, status)`: `message` is a string or a function of the extensions; `status` defaults to 500.
The constructor takes the extensions and the standard `ErrorOptions`, so a `cause` travels along.
