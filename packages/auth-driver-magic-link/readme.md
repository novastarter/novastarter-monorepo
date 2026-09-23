# `@novastarter/auth-driver-magic-link`

Sign-in by a link or a six-digit code sent by mail, a driver for `@novastarter/auth`.

## Installation

```
pnpm add @novastarter/auth @novastarter/auth-driver-magic-link
```

## Usage

Register the class once at start-up, then a location with the application's callbacks. The package stores and sends
nothing itself: the tokens go to the application's table through `issue` and come out through `spend`, the message goes
out through `send`.

```ts
import { useAuth } from '@novastarter/auth';
import { AuthDriverMagicLink } from '@novastarter/auth-driver-magic-link';

const auth = useAuth();

auth.registerDriver('magic-link', AuthDriverMagicLink);

auth.registerLocation('magic-link', {
	driver: 'magic-link',
	options: {
		findUser: async (email) => findUserByEmail(email),
		issue: async (record) => saveToken(record),
		spend: async (id, purpose) => deleteTokenReturning(id, purpose),
		send: async ({ email, token, format }) =>
			sendMagicLinkMail(email, format === 'link' ? `${origin}/auth/link?token=${token}` : token),
	},
});
```

Then two requests, through `startChallenge()` / `finishChallenge()` of `@novastarter/auth`:

```ts
// POST /auth/link — the form
await startChallenge('magic-link', { identifier: form.email, format: 'link' }); // or 'code'

// GET /auth/link?token=… — the link
const identity = await finishChallenge('magic-link', { input: { token: query.token } });

// POST /auth/code — the code, with the address it was sent to
const identity = await finishChallenge('magic-link', { input: { token: form.code, identifier: form.email } });
```

The identity is `{ provider: 'magic-link', subject: userId, email, emailVerified: true }`.

A link works without a cookie, so it can be opened on another device than the one that asked. A code is bound to the
account and checked against the `code` limiter of `@novastarter/auth`; `startChallenge()` charges the `signIn` limiter
per address, so one address cannot be flooded with mail.

Nothing is sent to an address no account has, and the answer is the same, so the form does not reveal which addresses
are registered. With `signUp: true` such an address gets a link — never a code — and the identity comes back with the
address as `subject` and `raw: { signUp: true }`: the application creates the account, in the `auth.sign-in` filter or
after `finishChallenge()`.

`issue` gets the record of `createToken()`: for a code, delete the user's other codes of the purpose (`magic-link`)
before storing it, since a code is keyed by user. `spend` must take the record out atomically — `DELETE … RETURNING` —
so a token works exactly once.

## Options

| Option        | Required | Description                                                                                                        |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `findUser`    | yes      | `(email) => Promise<{ id } \| null>`.                                                                              |
| `issue`       | yes      | `(record) => Promise<void>`: store a token record.                                                                 |
| `spend`       | yes      | `(id, purpose) => Promise<record \| null>`: take a record out atomically.                                          |
| `send`        | yes      | `({ email, token, format, userId, expiresAt }) => Promise<void>`: send the link or code; not awaited by `begin()`. |
| `onSendError` | —        | `(error, email) => void`: report a failed `send`; failures are dropped unless given.                               |
| `signUp`      | —        | Send a link to an address no account has; `false` unless given.                                                    |
| `ttl`         | —        | Link lifetime, milliseconds; the `tokens.ttl` setting unless given.                                                |
| `codeTtl`     | —        | Code lifetime, milliseconds; the `tokens.codeTtl` setting unless given.                                            |
