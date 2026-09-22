# `@novastarter/auth-driver-credentials`

Password sign-in driver for `@novastarter/auth`.

## Installation

```
pnpm add @novastarter/auth @novastarter/auth-driver-credentials
```

## Usage

Register the class once at start-up, then a location with the application's user lookup. The package knows nothing of
the application's users: `findUser` finds an account by what the person typed, `onRehash` stores a new hash.

```ts
import { useAuth } from '@novastarter/auth';
import { AuthDriverCredentials } from '@novastarter/auth-driver-credentials';
import { eq } from 'drizzle-orm';
import { db, users } from './db';

const auth = useAuth();

auth.registerDriver('credentials', AuthDriverCredentials);

auth.registerLocation('credentials', {
	driver: 'credentials',
	options: {
		findUser: async (email) =>
			(await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) })) ?? null,
		onRehash: async (id, hash) => {
			await db.update(users).set({ passwordHash: hash }).where(eq(users.id, id));
		},
	},
});
```

Anywhere later: `signIn('credentials', { identifier, password })` checks the password, charges the sign-in limiter and
answers `{ provider: 'credentials', subject: user.id }`.

The identifier reaches `findUser` trimmed and otherwise as typed; lower-casing an email is the lookup's business. The
password is checked with `verifyPassword()` of `@novastarter/auth` against the hash `hashPassword()` made.

Every failure is the same `InvalidCredentialsError` — an unknown account, an account without a password (one that only
signs in by OAuth), a wrong password — and takes the same time: without an account the password is still checked,
against a dummy hash of the configured cost made once per driver, so the response time does not tell which identifiers
exist.

After a successful sign-in, a hash made with another cost than `params` is replaced: the new hash goes to `onRehash`, so
old accounts follow the cost up without a password reset. A failing `onRehash` is logged as a warning and the sign-in
still succeeds; the next one tries again.

## Options

| Option     | Required | Description                                                                                    |
| ---------- | -------- | ---------------------------------------------------------------------------------------------- |
| `findUser` | yes      | `(identifier) => Promise<{ id, passwordHash } \| null>`; `passwordHash` is `null` without one. |
| `onRehash` | —        | `(id, hash) => Promise<void>`: store a fresh hash of an outdated one. Without it, none is.     |
| `params`   | —        | Scrypt cost of new hashes and of the dummy hash; `DEFAULT_SCRYPT_PARAMS` unless given.         |
