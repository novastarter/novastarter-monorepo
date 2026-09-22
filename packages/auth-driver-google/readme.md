# `@novastarter/auth-driver-google`

Google sign-in driver for `@novastarter/auth`, over OpenID Connect.

## Installation

```
pnpm add @novastarter/auth @novastarter/auth-driver-google
```

## Usage

Register the class once at start-up, then a location with the options read from the application's configuration — `env`
is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useAuth } from '@novastarter/auth';
import { AuthDriverGoogle } from '@novastarter/auth-driver-google';
import { env } from './env';

const auth = useAuth();

auth.registerDriver('google', AuthDriverGoogle);

auth.registerLocation('google', {
	driver: 'google',
	options: {
		clientId: env.AUTH_GOOGLE_CLIENT_ID,
		clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
	},
});
```

Two routes of the application run the sign-in. The first sends the browser to Google; the second is the redirect URI
registered on the OAuth client in the Google Cloud console, which Google calls back with a `GET` carrying `code` and
`state` in the query:

```ts
import { finishOAuth, startOAuth } from '@novastarter/auth';

const redirectUri = `${origin}/auth/google/callback`;

// GET /auth/google
const { url, cookie, expiresAt } = await startOAuth('google', { redirectUri });

jar.set('oauth', cookie, { httpOnly: true, secure: true, sameSite: 'lax', expires: expiresAt });
return Response.redirect(url);

// GET /auth/google/callback
const query = new URL(request.url).searchParams;
const { identity } = await finishOAuth('google', {
	state: query.get('state') ?? '',
	code: query.get('code') ?? '',
	cookie: jar.get('oauth')?.value,
});

jar.delete('oauth');
```

State, the PKCE verifier and the nonce are made by `startOAuth()` and travel in its encrypted cookie; the driver builds
the consent URL and, on the callback, exchanges the code at Google's token endpoint and reads the person from the ID
token. The token is verified against Google's published keys — fetched on first use, cached, and refetched when Google
rotates them — for its signature, issuer, audience (the client id), expiry and nonce, so no profile request follows.

The identity carries Google's `sub` as the `subject`, the `email` with `emailVerified` from `email_verified`, the `name`
and the `picture` as `avatarUrl`; the claims themselves are `raw`. A scope left out leaves its fields out. `openid` is
always asked for, since without it Google issues no ID token.

A refused code (`invalid_grant`), a token that fails a check, or a request that fails or times out throws an
`AuthProviderFailedError` naming the reason, with the original error as its `cause`.

`verify()` reads Google's key set: it proves Google is reachable, but not the client secret, which only a code exchange
can check.

## Options

| Option         | Required | Description                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------------ |
| `clientId`     | yes      | OAuth client id from the Google Cloud console (`….apps.googleusercontent.com`).      |
| `clientSecret` | yes      | OAuth client secret of that client.                                                  |
| `scopes`       | —        | Scopes to ask for; `openid email profile` unless given. `startOAuth()` can override. |
| `timeout`      | —        | How long one request to Google may take, in milliseconds; 10 s unless given.         |
