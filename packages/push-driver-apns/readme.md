# `@novastarter/push-driver-apns`

Apple Push Notification service driver for `@novastarter/push`.

## Installation

```
pnpm add @novastarter/push @novastarter/push-driver-apns
```

## Usage

Register the class once at start-up, then a location per app with the options read from the application's configuration
— `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { usePush } from '@novastarter/push';
import { PushDriverApns } from '@novastarter/push-driver-apns';
import { env } from './env';

const push = usePush();

push.registerDriver('apns', PushDriverApns);

push.registerLocation('apns', {
	driver: 'apns',
	options: {
		teamId: env.PUSH_APNS_TEAM_ID,
		keyId: env.PUSH_APNS_KEY_ID,
		signingKey: env.PUSH_APNS_SIGNING_KEY,
		topic: env.PUSH_APNS_TOPIC,
	},
});
```

Anywhere later: `sendPush({ token, platform: 'apns', … })` routes through the location, or
`usePush().location('apns').send(message)` skips the routes.

Through the `apns2` client (HTTP/2, token-based authentication with an APNs auth key, `.p8` — one key serves every app
of the team and never expires): iOS and macOS apps addressed by their device token, sent to Apple directly. A key pasted
into a `.env` line keeps working, its `\n` escapes are restored; the key is checked to be a P-256 EC key at
construction, so a wrong file fails at start-up. Production unless `production: false` — a token from a development
build only works with the sandbox.

The title and body go under `aps.alert`; the click target, the image and the custom pairs are top-level keys of the
payload (`url`, `image`, then `data`), an image sets `mutable-content` for the app's notification service extension.
`urgency` becomes the APNs priority (`high` → 10, `normal` → 5, the low ones → 1), `tag` the collapse id — anything
outside letters, digits and `_ . : -` replaced by `_`, cut to 64 bytes, dropped when empty — `ttl` the expiration. The
result is `accepted`; APNs hands out no id the client exposes.

A token APNs reports as `Unregistered`, `BadDeviceToken` or `DeviceTokenNotForTopic` is dead and is thrown as
`PushTargetGoneError`; any other refusal throws an error naming APNs's status and reason, the network error as is — all
with the original as `cause`. A send that outlives `timeout` throws an error naming the deadline, the `TimeoutError` of
`@novastarter/utils` as `cause`; the request itself runs on, the HTTP client cannot be told to stop. The signing key is
checked at construction; the team, the key id and the topic are only judged by APNs on a push, so a wrong id shows up as
`InvalidProviderToken` or `TopicDisallowed` on the first message rather than at start-up. `close()` ends the HTTP/2
sessions, whose keep-alive pings would otherwise keep the process alive.

## Options

| Option       | Required | Description                                                                                   |
| ------------ | -------- | --------------------------------------------------------------------------------------------- |
| `teamId`     | yes      | The Apple Developer team id (Membership details).                                             |
| `keyId`      | yes      | The id of the APNs auth key (Certificates, Identifiers & Profiles → Keys).                    |
| `signingKey` | yes      | The auth key's PEM, the text of the `.p8` file.                                               |
| `topic`      | yes      | The app's bundle id — the `apns-topic` of every push.                                         |
| `production` | —        | Send through the production APNs; `false` for the sandbox development builds register with.   |
| `host`       | —        | APNs hostname, overriding `production`.                                                       |
| `ttl`        | —        | Seconds APNs keeps a message for an offline device; `0` delivers once or never.               |
| `sound`      | —        | Sound of a notification; `default` unless given, empty for a silent one.                      |
| `timeout`    | —        | Milliseconds a send may take before it fails; only the HTTP client's own limits unless given. |
