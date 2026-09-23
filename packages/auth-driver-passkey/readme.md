# `@novastarter/auth-driver-passkey`

Passkey (WebAuthn) sign-in driver for `@novastarter/auth`, on [`@simplewebauthn/server`](https://simplewebauthn.dev).

## Installation

```
pnpm add @novastarter/auth @novastarter/auth-driver-passkey
```

In the browser, `@simplewebauthn/browser` turns the options into `navigator.credentials` calls and back.

## Usage

Register the class once at start-up, then a location with the relying party and the application's key lookup. The
package stores nothing: the keys live in the application's table, one row per key, as `PasskeyCredential`. The challenge
cookie needs the `challenge.secret` setting of `@novastarter/auth`.

```ts
import { useAuth } from '@novastarter/auth';
import { AuthDriverPasskey } from '@novastarter/auth-driver-passkey';

const auth = useAuth();

auth.registerDriver('passkey', AuthDriverPasskey);

auth.registerLocation('passkey', {
	driver: 'passkey',
	options: {
		rpId: 'example.com',
		rpName: 'Example',
		origin: 'https://example.com',
		findCredential: async (id) => findPasskey(id),
		updateCounter: async (id, counter) => savePasskeyCounter(id, counter),
	},
});
```

Adding a key to the account signed in now:

```ts
import { finishPasskeyRegistration, startPasskeyRegistration } from '@novastarter/auth-driver-passkey';

// POST /account/passkeys/options
const { options, cookie, expiresAt } = await startPasskeyRegistration('passkey', {
	userId: session.userId,
	userName: user.email,
	exclude: await listPasskeys(session.userId),
});

// POST /account/passkeys
const key = await finishPasskeyRegistration('passkey', { userId: session.userId, response, cookie });
await savePasskey(key);
```

Signing in, through `startChallenge()` / `finishChallenge()` of `@novastarter/auth`:

```ts
// POST /auth/passkey/options
const { options, cookie, expiresAt } = await startChallenge('passkey');

// POST /auth/passkey
const identity = await finishChallenge('passkey', { input: { response }, cookie });
```

The identity is `{ provider: 'passkey', subject: userId }`. Nobody types a name first: the browser offers the keys it
holds for the site. Every sign-in stores the key's new signature counter through `updateCounter`. An unknown key or an
answer that does not check out is `InvalidCredentialsError`; a missing or broken cookie is `AuthInvalidTokenError`.

## Options

| Option             | Required | Description                                                                          |
| ------------------ | -------- | ------------------------------------------------------------------------------------ |
| `rpId`             | yes      | The site's domain: `example.com`.                                                    |
| `rpName`           | yes      | The name the passkey prompt shows.                                                   |
| `origin`           | yes      | The origin, or origins, of the pages: `https://example.com`.                         |
| `findCredential`   | yes      | `(id) => Promise<PasskeyCredential \| null>`.                                        |
| `updateCounter`    | yes      | `(id, counter) => Promise<void>`.                                                    |
| `userVerification` | —        | `required` (fingerprint or PIN every time) or `preferred`; `preferred` unless given. |
