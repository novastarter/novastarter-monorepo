# `@novastarter/auth-driver-github`

GitHub sign-in driver for `@novastarter/auth`.

## Installation

```
pnpm add @novastarter/auth @novastarter/auth-driver-github
```

## Usage

Register the class once at start-up, then a location with the options read from the application's configuration — `env`
is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useAuth } from '@novastarter/auth';
import { AuthDriverGithub } from '@novastarter/auth-driver-github';
import { env } from './env';

const auth = useAuth();

auth.registerDriver('github', AuthDriverGithub);

auth.registerLocation('github', {
	driver: 'github',
	options: {
		clientId: env.AUTH_GITHUB_CLIENT_ID,
		clientSecret: env.AUTH_GITHUB_CLIENT_SECRET,
	},
});
```

Two routes of the application run the sign-in. The first sends the browser to GitHub; the second is the callback URL
registered on the OAuth app in GitHub's developer settings, which GitHub calls back with a `GET` carrying `code` and
`state` in the query:

```ts
import { finishOAuth, startOAuth } from '@novastarter/auth';

const redirectUri = `${origin}/auth/github/callback`;

// GET /auth/github
const { url, cookie, expiresAt } = await startOAuth('github', { redirectUri });

jar.set('oauth', cookie, { httpOnly: true, secure: true, sameSite: 'lax', expires: expiresAt });
return Response.redirect(url);

// GET /auth/github/callback
const query = new URL(request.url).searchParams;
const { identity } = await finishOAuth('github', {
	state: query.get('state') ?? '',
	code: query.get('code') ?? '',
	cookie: jar.get('oauth')?.value,
});

jar.delete('oauth');
```

State and the PKCE verifier are made by `startOAuth()` and travel in its encrypted cookie; GitHub is plain OAuth and
issues no ID token, so the nonce is not used. On the callback the driver exchanges the code for an access token, then
reads `GET /user` and `GET /user/emails` with it. The driver keeps nothing: the token comes back from `finishOAuth()` as
`tokens` — `accessToken`, `scope` (the scopes the person granted) and `tokenType`, plus `refreshToken` and `expiresAt`
for a GitHub App with expiring user tokens. It is a secret; storing it, encrypted with a key of the application's own,
is the application's responsibility.

The identity carries the numeric account id as the `subject` — a login can be renamed and then taken by someone else —
the `name`, or the login when the person set none, and `avatar_url` as `avatarUrl`; the profile itself is `raw`. The
`email` is the primary address, and only when GitHub verified it, so `emailVerified` is always `true` when an address is
present. Without the `user:email` scope the address list is refused and the identity carries no address.

GitHub refuses a spent or forged code with `200 OK` and `bad_verification_code` in the body; that, a refused profile
request, an outage of the address list, or a request that fails or times out throws an `AuthProviderFailedError` naming
the reason, with the original as its `cause`.

The driver has no `verify()`: GitHub offers no request that checks a client secret without a code.

## Any other request

`call()` reaches any endpoint of GitHub's REST API: the verb and the path from `https://api.github.com`. With
`accessToken` it acts as that person, within the scopes they granted; the parameters are the query of a `GET`, `HEAD` or
`DELETE` and the JSON body otherwise:

```ts
const github = useAuth().location('github');

const repos = await github.call?.('GET /user/repos', { per_page: 100, sort: 'updated' }, { accessToken });
```

Without `accessToken` the request is authenticated as the OAuth app, with Basic `clientId:clientSecret` — what the
`/applications/{client_id}/…` endpoints take; `{client_id}` in the path is replaced with the app's client id:

```ts
// Check a stored token is still valid, and read the scopes and the user it belongs to
const check = await github.call?.('POST /applications/{client_id}/token', { access_token: accessToken });
```

Every request carries `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` and a `User-Agent`;
`options.headers` go on top, `options.timeout` replaces the location's. A full URL may only point at `api.github.com` or
`uploads.github.com`; any other host is refused before the request. An error status throws `ProviderCallError` with
GitHub's status and answer in `extensions`, a timeout `TimeoutError`; no token or secret goes into an error message. A
rate limit throws `HitRateLimitError` — a 429, or a 403 with the limit spent (`x-ratelimit-remaining: 0`, reset at
`x-ratelimit-reset`) or a `Retry-After` — its `reset` at the time GitHub names.

## Options

| Option         | Required | Description                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------------ |
| `clientId`     | yes      | Client id of the OAuth app (or GitHub App) from GitHub's developer settings.         |
| `clientSecret` | yes      | Client secret of that app.                                                           |
| `scopes`       | —        | Scopes to ask for; `read:user user:email` unless given. `startOAuth()` can override. |
| `timeout`      | —        | How long one request to GitHub may take, in milliseconds; 10 s unless given.         |
