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
	if (isNovastarterError<{ thing: string }>(error, 'INVALID_THING')) {
		error.status; // 400
		error.extensions.thing; // 'foo'
	}
}
```

The guard knows the extensions of the codes in `ErrorCode`, so `isNovastarterError(error, ErrorCode.InvalidPayload)`
types `error.extensions` on its own. For a code of your own it cannot, so pass the extensions type as shown above;
without it `error.extensions` is `unknown`.

The classes of the kit:

```ts
import { ErrorCode, HitRateLimitError, InvalidCredentialsError, InvalidPayloadError } from '@novastarter/errors';

throw new InvalidPayloadError({ reason: 'Field "email" is required' });
// message: 'Invalid payload. Field "email" is required.', code: 'INVALID_PAYLOAD', status: 400

throw new InvalidCredentialsError();
// message: 'Invalid credentials.', code: 'INVALID_CREDENTIALS', status: 401

throw new HitRateLimitError({
	limit: 10,
	reset: new Date(Date.now() + 5_000),
});
// message: 'Too many requests, retry after 5s.', code: 'REQUESTS_EXCEEDED', status: 429

ErrorCode.InvalidPayload; // 'INVALID_PAYLOAD' — the codes, for matching
```

A driver's `call()` turns a provider's error answer into the kit's with `toProviderCallError()`: a 429 becomes a
`HitRateLimitError` reset at `Retry-After`, anything else a `ProviderCallError` (`PROVIDER_CALL_FAILED`, 502) with the
provider's own status and answer in `extensions`, and its reason — read out of the usual shapes by
`providerErrorReason()` — in the message:

```ts
import { ProviderCallError, toProviderCallError } from '@novastarter/errors';

throw toProviderCallError({ provider: 'stripe', method: 'POST /v1/refunds', status: 404, body, headers });
// message: 'stripe refused POST /v1/refunds: 404 No such payment_intent', extensions.status: 404

if (error instanceof ProviderCallError && error.extensions.status === 404) {
	// …
}
```

`createError(code, message, status)`: `message` is a string or a function of the extensions; `status` defaults to 500.
The constructor takes the extensions and the standard `ErrorOptions`, so a `cause` travels along.
