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

The driver keeps nothing of the exchange: the access token comes back from `finishOAuth()` as `tokens` — `accessToken`,
`expiresAt`, `scope` (the scopes the person granted) and `tokenType`, plus `refreshToken` when the consent asked for
offline access. They are secrets; storing them, encrypted with a key of the application's own, is the application's
responsibility.

The identity carries Google's `sub` as the `subject`, the `email` with `emailVerified` from `email_verified`, the `name`
and the `picture` as `avatarUrl`; the claims themselves are `raw`. A scope left out leaves its fields out. `openid` is
always asked for, since without it Google issues no ID token.

A refused code (`invalid_grant`), a token that fails a check, or a request that fails or times out throws an
`AuthProviderFailedError` naming the reason, with the original error as its `cause`.

`verify()` reads Google's key set: it proves Google is reachable, but not the client secret, which only a code exchange
can check.

## Any other request

`call()` reaches any of Google's APIs: the verb and the path from `https://www.googleapis.com`, or a full URL on a
`googleapis.com` host. With `accessToken` it acts as that person, within the scopes they granted — ask for them with
`scopes` on the location or `startOAuth()`; the parameters are the query of a `GET`, `HEAD` or `DELETE` and the JSON
body otherwise:

```ts
const google = useAuth().location('google');

// Scope https://www.googleapis.com/auth/calendar.readonly
const { data: calendars } = await google.call!(
	'GET /calendar/v3/users/me/calendarList',
	{ maxResults: 50 },
	{ accessToken },
);

// Scope https://www.googleapis.com/auth/contacts.readonly
const { data: me } = await google.call!(
	'GET https://people.googleapis.com/v1/people/me',
	{ personFields: 'names,emailAddresses' },
	{ accessToken },
);
```

A `{name}` in the path is filled from the parameter of that name, URL-encoded, and that parameter is not sent again; a
placeholder nobody filled is refused before the request. Every call answers `{ status, headers, data }`, header names
lower-cased:

```ts
// GET /calendar/v3/calendars/primary/events?maxResults=10
const { status, headers, data } = await google.call!(
	'GET /calendar/v3/calendars/{calendarId}/events',
	{ calendarId: 'primary', maxResults: 10 },
	{ accessToken },
);

console.log(status, headers['etag'], data);
```

Without `accessToken` no `Authorization` header is sent — for an endpoint that needs none, or one that takes an API key
as the `key` parameter. `options.headers` go on top, `options.timeout` replaces the location's. A full URL may only
point at `*.googleapis.com`; any other host is refused before the request. An error status throws `ProviderCallError`
with Google's status and answer in `extensions`, a 429 `HitRateLimitError`, a timeout `TimeoutError`; no token or secret
goes into an error message.

## Options

| Option         | Required | Description                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------------ |
| `clientId`     | yes      | OAuth client id from the Google Cloud console (`….apps.googleusercontent.com`).      |
| `clientSecret` | yes      | OAuth client secret of that client.                                                  |
| `scopes`       | —        | Scopes to ask for; `openid email profile` unless given. `startOAuth()` can override. |
| `timeout`      | —        | How long one request to Google may take, in milliseconds; 10 s unless given.         |
