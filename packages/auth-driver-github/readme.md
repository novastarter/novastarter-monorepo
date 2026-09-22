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
reads `GET /user` and `GET /user/emails` with it. The token is not kept.

The identity carries the numeric account id as the `subject` — a login can be renamed and then taken by someone else —
the `name`, or the login when the person set none, and `avatar_url` as `avatarUrl`; the profile itself is `raw`. The
`email` is the primary address, and only when GitHub verified it, so `emailVerified` is always `true` when an address is
present. Without the `user:email` scope the address list is refused and the identity carries no address.

GitHub refuses a spent or forged code with `200 OK` and `bad_verification_code` in the body; that, a refused profile
request, an outage of the address list, or a request that fails or times out throws an `AuthProviderFailedError` naming
the reason, with the original as its `cause`.

The driver has no `verify()`: GitHub offers no request that checks a client secret without a code.

## Options

| Option         | Required | Description                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------------ |
| `clientId`     | yes      | Client id of the OAuth app (or GitHub App) from GitHub's developer settings.         |
| `clientSecret` | yes      | Client secret of that app.                                                           |
| `scopes`       | —        | Scopes to ask for; `read:user user:email` unless given. `startOAuth()` can override. |
| `timeout`      | —        | How long one request to GitHub may take, in milliseconds; 10 s unless given.         |
