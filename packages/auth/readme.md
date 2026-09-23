# `@novastarter/auth`

Authentication API for Novastarter: sign-in providers, sessions, passwords, one-time and JWT tokens, TOTP.

## Installation

```
pnpm add @novastarter/auth @novastarter/auth-driver-credentials @novastarter/auth-driver-google
```

One driver package per sign-in method: `auth-driver-credentials`, `auth-driver-google`, `auth-driver-github`.

## How it works

The package stores nothing. It makes tokens, hashes, signs, encrypts and checks; every function that creates something
returns a record, and the application keeps it in its own tables. To check, the application finds the record — by
`hashToken(token)` or `oneTimeTokenId(token)` — and hands it back. Users are the application's too: the credentials
driver asks it for the user, and a provider sign-in ends with an identity the application maps to an account.

What stays with the application is what only a store can do atomically: spending a one-time token or a recovery code is
a `DELETE … RETURNING`, rotating a refresh token and moving a TOTP step are conditional `UPDATE`s. The functions below
say where.

## Usage

At start-up, once: the sign-in drivers, a location per provider, then the settings. `env` is the app's typed
configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useAuth } from '@novastarter/auth';
import { AuthDriverCredentials } from '@novastarter/auth-driver-credentials';
import { AuthDriverGoogle } from '@novastarter/auth-driver-google';
import { useLimiter } from '@novastarter/memory';
import { env } from './env';

const auth = useAuth();

auth.registerDriver('credentials', AuthDriverCredentials);
auth.registerDriver('google', AuthDriverGoogle);

auth.registerLocation('credentials', {
	driver: 'credentials',
	options: {
		findUser: async (email) => findUserByEmail(email),
	},
});

auth.registerLocation('google', {
	driver: 'google',
	options: {
		clientId: env.AUTH_GOOGLE_CLIENT_ID,
		clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
	},
});

auth.registerSettings({
	session: { ttl: 30 * 24 * 60 * 60 * 1000, idleTtl: 7 * 24 * 60 * 60 * 1000 },
	jwt: { secret: env.AUTH_JWT_SECRET },
	mfa: { issuer: 'Acme', encryptionKey: env.AUTH_MFA_ENCRYPTION_KEY },
	oauth: { secret: env.AUTH_OAUTH_SECRET },
	limiters: {
		signIn: useLimiter().location('auth-sign-in'),
		mfa: useLimiter().location('auth-mfa'),
		code: useLimiter().location('auth-code'),
	},
});
```

The package reads nothing from the environment. Secrets are at least 32 characters of random data; a feature whose
secret is missing or short refuses to run.

## Signing in

With a form: `signIn('credentials', { identifier, password })` returns the identity, or throws
`InvalidCredentialsError`. Every attempt costs a point of the `signIn` limiter, per location and identifier; a success
clears it.

With a provider, two requests:

```ts
import { finishOAuth, startOAuth } from '@novastarter/auth';

// GET /auth/google
const { url, cookie, expiresAt } = await startOAuth('google', { redirectUri: `${origin}/auth/google/callback` });
jar.set('oauth', cookie, { httpOnly: true, secure: true, sameSite: 'lax', expires: expiresAt });

// GET /auth/google/callback?state=…&code=…
const { identity } = await finishOAuth('google', {
	state: query.state,
	code: query.code,
	cookie: jar.get('oauth')?.value,
});
jar.delete('oauth');
```

`startOAuth()` makes the state, a PKCE verifier and a nonce, and seals them with the location and a deadline into a
cookie encrypted with `oauth.secret` (AES-256-GCM, key derived with HKDF): nothing is kept on the server, and the
browser can neither read nor change it. `finishOAuth()` opens it, checks the deadline, the location and the state, and
lets the driver exchange the code.

With a two-step challenge — a link or a code by mail (`@novastarter/auth-driver-magic-link`), a passkey
(`@novastarter/auth-driver-passkey`) — two requests as well:

```ts
import { finishChallenge, startChallenge } from '@novastarter/auth';

// POST /auth/passkey/options
const { options, cookie, expiresAt } = await startChallenge('passkey');
if (cookie) jar.set('challenge', cookie, { httpOnly: true, secure: true, sameSite: 'lax', expires: expiresAt });

// POST /auth/passkey
const identity = await finishChallenge('passkey', { input: { response }, cookie: jar.get('challenge')?.value });
jar.delete('challenge');
```

`startChallenge()` lets the driver begin — send the mail, make the passkey's challenge — and seals whatever state it
keeps into a cookie encrypted with `challenge.secret`; a driver that keeps none (a link, which may be opened in another
browser) hands out no cookie. An input with an `identifier` costs a point of the `signIn` limiter, so one address cannot
be flooded with mail. `finishChallenge()` opens the cookie when there is one and lets the driver check the answer.

Every sign-in passes the `auth.sign-in` filter — a handler returning `null` refuses it with `InvalidCredentialsError` —
then emits `auth.signed-in` with the identity under `payload`; a failure emits `auth.sign-in-failed` with a `reason`.

## Sessions

```ts
import { checkSession, createSession, hashToken } from '@novastarter/auth';

const { token, session } = createSession(identity.subject, { metadata: { userAgent } });
// store `session`; set `token` as the cookie

const check = checkSession(await findSession(hashToken(token)));
// 'invalid': delete the record if there was one; 'valid' with `extended`: store `check.session.expiresAt`
```

The token is 256 random bits; the record's `id` is its SHA-256, so a leaked table signs nobody in. With
`session.idleTtl`, `checkSession()` pushes the idle deadline back once half of it has passed, never past the hard `ttl`.
Signing out is deleting the record.

## Passwords

`hashPassword(password)` hashes with scrypt (`N = 2^17, r = 8, p = 1` by default) into a PHC string —
`$scrypt$ln=17,r=8,p=1$<salt>$<key>` — that carries its cost. `verifyPassword(password, hash)` compares in constant
time; `needsRehash(hash)` says when the cost changed, so the hash can be replaced at the next sign-in. Passwords are
normalised to NFKC and limited to 1024 characters; a stored hash asking for more than 1 GiB is refused.

## One-time tokens

```ts
import { checkToken, createToken } from '@novastarter/auth';

const { token, record } = createToken({ purpose: 'password-reset', userId: user.id });
// store `record`; send `token`

const { userId } = await checkToken({
	purpose: 'password-reset',
	token,
	spend: (id, purpose) => deleteTokenReturning(id, purpose),
});
```

A `link` token is 256 random bits. `format: 'code'` makes six digits for typing in: its id is bound to the user —
`oneTimeTokenId(code, userId)`, `checkToken({ purpose, token, userId, spend })` — every attempt costs a point of the
`code` limiter and a right one clears it, and the application deletes the user's other tokens of the purpose before
storing it. A token lives `tokens.ttl` (1 hour) or `tokens.codeTtl` (10 minutes); `spend` takes it out with one atomic
`DELETE … RETURNING`, so it works once.

## JWT tokens

For clients without cookies:

```ts
import { issueTokenPair, refreshTokenPair, verifyAccessToken } from '@novastarter/auth';

const { pair, refresh } = await issueTokenPair(user.id, { claims: { role: 'admin' } });
// store `refresh`; return `pair`

const { userId, claims } = await verifyAccessToken(bearer);

const next = await refreshTokenPair({
	token: pair.refreshToken,
	find: (id) => findRefresh(id),
	// store `next`, then mark `current` used only if still unused; `false` when the mark matched nothing
	rotate: (current, next) => storeAndMarkUsed(current, next),
	revokeFamily: (familyId) => deleteFamily(familyId),
});
```

The access token is a JWT (`typ: at+jwt`, `sub`, `exp`, `iat`, `jti`, `iss` and `aud` when configured) signed with
`HS256` and `jwt.secret`, or with `ES256` / `EdDSA` and a PEM key pair. It is checked without any lookup and cannot be
revoked, so it lives 15 minutes by default. The refresh token is opaque; each one works once. Used ones stay stored
until they expire: a used one presented again, or a rotation lost to a concurrent one, means two parties hold it, and
`refreshTokenPair()` revokes the whole family through `revokeFamily`.

## TOTP

```ts
import { enrollTotp, generateRecoveryCodes, verifyRecoveryCode, verifyTotp } from '@novastarter/auth';

const { uri, secret, encryptedSecret } = enrollTotp({ accountName: user.email });

await verifyTotp({ userId, encryptedSecret, code, advance: (step) => moveLastStepForward(userId, step) });
const { codes, ids } = generateRecoveryCodes();

await verifyRecoveryCode({ userId, code, spend: (id) => deleteRecoveryCodeReturning(userId, id) });
```

Six digits, 30 seconds, SHA-1, one step of drift either way — what every authenticator app does. The secret is stored
encrypted with `mfa.encryptionKey`. `advance` records the code's step only forward, so a code is accepted once and never
one older than the last; `spend` deletes a recovery code atomically. Both charge the `mfa` limiter and clear it on
success; `isTotpCode(code)` tells which of the two a typed code is.

## Settings

| Setting                                              | Default          | Description                                            |
| ---------------------------------------------------- | ---------------- | ------------------------------------------------------ |
| `session.ttl` / `session.idleTtl`                    | 30 days / none   | Hard and idle session lifetime, milliseconds.          |
| `tokens.ttl` / `tokens.codeTtl`                      | 1 hour / 10 min  | One-time link and code lifetime.                       |
| `oauth.secret`                                       | —                | Required for OAuth: encrypts the OAuth cookie.¹        |
| `oauth.stateTtl`                                     | 10 minutes       | How long the browser has to come back.                 |
| `challenge.secret`                                   | —                | Required for passkeys: encrypts the challenge cookie.¹ |
| `challenge.ttl`                                      | 5 minutes        | How long the browser has to finish a challenge.        |
| `jwt.secret` or `jwt.privateKey` + `publicKey`       | —                | Required for JWTs. `jwt.algorithm` picks the key type. |
| `jwt.issuer` / `jwt.audience`                        | —                | Set on issue, checked on verify.                       |
| `jwt.accessTtl` / `jwt.refreshTtl`                   | 15 min / 30 days | Token lifetimes.                                       |
| `mfa.encryptionKey`                                  | —                | Required for TOTP: encrypts the stored secrets.¹       |
| `mfa.issuer`                                         | `Novastarter`    | The name authenticator apps show.                      |
| `limiters.signIn` / `limiters.mfa` / `limiters.code` | none             | `LimiterDriver`s of `@novastarter/memory`.             |

¹ A list rotates the secret: the first encrypts, every one decrypts. Put the new secret first and keep the old one
behind it — for `oauth.secret` until `stateTtl` has passed, for `challenge.secret` until `challenge.ttl` has, for
`mfa.encryptionKey` until every stored secret went through `reencryptTotpSecret(encryptedSecret)`, which returns it
under the new key, or `null` when it already is. Each setting derives a key of its own with HKDF, so one secret shared
by both never gives the same key twice.

## Errors

- `AuthInvalidTokenError` (401): a token, JWT, refresh token, OAuth or challenge cookie that cannot be used — the reason
  is not told apart.
- `AuthProviderFailedError` (502): a provider refused the code or answered with something unusable.
- `InvalidCredentialsError` (401, `@novastarter/errors`): wrong password or code, or a filter refused the sign-in.
- `HitRateLimitError` (429, `@novastarter/errors`): a limiter ran out.

## Writing a driver

A sign-in driver implements `authorize()` + `callback()` (OAuth), `authenticate()` (a form) or `begin()` + `complete()`
(a two-step challenge) of `AuthDriver`, and adds itself to the driver map:

```ts
import type { AuthDriver, AuthIdentity, AuthorizeParams, CallbackParams } from '@novastarter/auth';

declare module '@novastarter/auth' {
	interface AuthDrivers {
		gitlab: AuthDriverGitlabConfig;
	}
}

export class AuthDriverGitlab implements AuthDriver {
	constructor(config: AuthDriverGitlabConfig) {}
	async authorize(params: AuthorizeParams): Promise<URL> {}
	async callback(params: CallbackParams): Promise<AuthIdentity> {}
}
```
