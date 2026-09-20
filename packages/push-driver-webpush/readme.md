# `@novastarter/push-driver-webpush`

Web Push driver for `@novastarter/push`.

## Installation

```
pnpm add @novastarter/push @novastarter/push-driver-webpush
```

## Usage

Register the class once at start-up, then a location per VAPID key pair with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { usePush } from '@novastarter/push';
import { PushDriverWebPush } from '@novastarter/push-driver-webpush';
import { env } from './env';

const push = usePush();

push.registerDriver('webpush', PushDriverWebPush);

push.registerLocation('webpush', {
	driver: 'webpush',
	options: {
		publicKey: env.PUSH_WEBPUSH_PUBLIC_KEY,
		privateKey: env.PUSH_WEBPUSH_PRIVATE_KEY,
		subject: env.PUSH_WEBPUSH_SUBJECT,
	},
});
```

Anywhere later: `sendPush(message)` routes through the location, or `usePush().location('webpush').send(message)` skips
the routes.

Through the [Web Push protocol](https://datatracker.ietf.org/doc/html/rfc8030) with VAPID, on `web-push`: the push
services of Chrome, Firefox, Safari and Edge. The key pair is the location's identity —
`npx web-push generate-vapid-keys` makes one — and a subscription made with one public key is refused by the push
service for any other private key, so rotating the keys means re-subscribing every browser. `applicationServerKey` on
the driver is the public key, for the browser's
`PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.

The payload is the JSON of `toWebPushPayload()` (title, body, icon, image, badge, tag and `data` with the click target
under `url`), encrypted for the subscription. `ttl` and `urgency` of a message go out as the `TTL` and `Urgency`
headers, `tag` as the `Topic` header (at most 32 URL-safe base64 characters; anything else becomes `_`). The result
carries the push service's HTTP status; there is no message id.

A `404` or `410` from the push service means the subscription is gone (the user unsubscribed, the browser rotated it,
the site's permission was revoked) and is thrown as `PushTargetGoneError`; any other status throws an error with the
status and body, the network error as is — both with the original as `cause`. `verify()` signs a VAPID token with the
keys and proves they are a P-256 pair, without contacting a push service.

## Options

| Option            | Required | Description                                                                               |
| ----------------- | -------- | ----------------------------------------------------------------------------------------- |
| `publicKey`       | yes      | VAPID public key, URL-safe base64 — what the browser subscribes with.                     |
| `privateKey`      | yes      | VAPID private key, URL-safe base64.                                                       |
| `subject`         | yes      | Whom a push service may contact about the sender: a `mailto:` address or an `https:` URL. |
| `ttl`             | —        | Seconds a push service keeps a message for an offline device; four weeks unless given.    |
| `contentEncoding` | —        | `aes128gcm` (every current browser) unless given; `aesgcm` for a service predating it.    |
| `timeout`         | —        | Socket timeout of a request in milliseconds.                                              |
| `proxy`           | —        | Proxy URL for the requests to the push services.                                          |
