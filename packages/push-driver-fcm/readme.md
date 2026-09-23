# `@novastarter/push-driver-fcm`

Firebase Cloud Messaging push driver for `@novastarter/push`.

## Installation

```
pnpm add @novastarter/push @novastarter/push-driver-fcm
```

## Usage

Register the class once at start-up, then a location per Firebase project with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { usePush } from '@novastarter/push';
import { PushDriverFcm } from '@novastarter/push-driver-fcm';
import { env } from './env';

const push = usePush();

push.registerDriver('fcm', PushDriverFcm);

push.registerLocation('fcm', {
	driver: 'fcm',
	options: {
		serviceAccount: env.PUSH_FCM_SERVICE_ACCOUNT,
	},
});
```

Anywhere later: `sendPush(message)` routes through the location, or `usePush().location('fcm').send(message)` skips the
routes.

Through `firebase-admin`, the FCM HTTP v1 API: native Android and iOS apps and browsers on the Firebase SDK, addressed
by their registration token. The credentials are the service account the Firebase console downloads — its JSON as text
or parsed in `serviceAccount`, or the three fields on their own; a private key pasted into a `.env` line keeps working,
its `\n` escapes are restored. Each location gets a Firebase app of its own, so two projects, or the application's own
Firebase use, never collide.

The message goes out with a `notification` block for every platform and the blocks each one needs: the Android priority,
TTL and collapse key, the APNs headers and `mutable-content` for an image, the web push icon, badge, image, tag and —
for an `https:` target — the click link; `data` carries the custom pairs with the click target under `url`. An image
reaches the common block and the APNs block as an absolute `http(s):` URL only, the one form FCM accepts there; a
relative one is delivered to browsers alone. A `ttl` of `0` is "now or never" on every platform, and the tag is cut to
the 64 bytes APNs takes as a collapse id. The result is FCM's message name as the id.

A token FCM reports as `registration-token-not-registered` or `invalid-registration-token` is dead and is thrown as
`PushTargetGoneError`; any other refusal throws an error naming FCM's code, the network error as is — both with the
original as `cause`. `verify()` fetches an OAuth access token with the service account, what every send does first.
`close()` deletes the Firebase app, whose agents would otherwise keep the process alive.

## Any other request

`call(method, params, options)` reaches the rest of FCM with an OAuth access token of the service account, the
location's `timeout` (30 s unless given) and the kit's errors, and answers `{ status, headers, data }`. A path goes
under `https://fcm.googleapis.com`, where `{projectId}` stands for the service account's project; the parameters are the
query of a `GET`, `HEAD` or `DELETE` and a JSON body otherwise. The timeout and the signal bound the token's fetch too.

```ts
const fcm = usePush().location('fcm');

const { data } = await fcm.call!('POST /v1/projects/{projectId}/messages:send', {
	message: { topic: 'news', notification: { title: 'Breaking' } },
});

await fcm.call!(
	'POST https://iid.googleapis.com/iid/v1:batchAdd',
	{ to: '/topics/news', registration_tokens: [token] },
	{ headers: { access_token_auth: 'true' } },
);
```

A full URL may point at `fcm.googleapis.com` and `iid.googleapis.com` only; any other host is refused before a token is
fetched. An error status throws `ProviderCallError` with Google's `{ error: { code, message, status } }` in
`extensions.body`, a `429` throws `HitRateLimitError`, and the timeout `TimeoutError`.

Another `{name}` in the path is filled from the parameter of that name, URL-encoded, and that parameter is not sent
again; a `{name}` no parameter fills is refused before a request. The headers come with names lower-cased — a
`retry-after`, say.

```ts
const fcm = usePush().location('fcm');

const { status, headers, data } = await fcm.call!<{ rel?: { topics?: Record<string, unknown> } }>(
	'GET https://iid.googleapis.com/iid/info/{token}',
	{ token, details: true },
	{ headers: { access_token_auth: 'true' } },
);

console.log(status, Object.keys(data.rel?.topics ?? {}), headers['retry-after']);
```

## Options

| Option           | Required | Description                                                                                       |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `serviceAccount` | yes\*    | The service account JSON, as text or parsed; or the three fields below.                           |
| `projectId`      | —        | The Firebase project id, when not in `serviceAccount`.                                            |
| `clientEmail`    | —        | The service account's email, when not in `serviceAccount`.                                        |
| `privateKey`     | —        | The service account's PEM private key, when not in `serviceAccount`.                              |
| `ttl`            | —        | Seconds FCM keeps a message for an offline device, `0` for now or never; four weeks unless given. |
| `analyticsLabel` | —        | Label the messages carry into the Firebase analytics, for the console's delivery reports.         |

\* Either `serviceAccount`, or `projectId`, `clientEmail` and `privateKey` together.
