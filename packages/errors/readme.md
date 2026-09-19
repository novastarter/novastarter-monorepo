# `@novastarter/errors`

Create consistent error objects around the codebase

## Usage

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
	}
}
```
