# `@novastarter/push`

Push notification abstraction layer for Novastarter.

## Installation

```
pnpm add @novastarter/push @novastarter/push-driver-webpush
```

One driver package per platform: `push-driver-webpush` (browsers, through the Web Push protocol with VAPID),
`push-driver-fcm` (Firebase Cloud Messaging: native Android and iOS apps, browsers on the Firebase SDK),
`push-driver-apns` (Apple Push Notification service, directly). The `console` driver ships inside this package.

## Usage

At start-up, once — vendor drivers as classes, locations as explicit options, then the routes; a driver is built on the
location's first use. The same driver can back several locations with different key pairs or projects, and `driver`
decides the type of `options`; `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { usePush } from '@novastarter/push';
import { PushDriverFcm } from '@novastarter/push-driver-fcm';
import { PushDriverWebPush } from '@novastarter/push-driver-webpush';
import { env } from './env';

const push = usePush();

push.registerDriver('webpush', PushDriverWebPush);
push.registerDriver('fcm', PushDriverFcm);

push.registerLocation('webpush', {
	driver: 'webpush',
	options: {
		publicKey: env.PUSH_WEBPUSH_PUBLIC_KEY,
		privateKey: env.PUSH_WEBPUSH_PRIVATE_KEY,
		subject: env.PUSH_WEBPUSH_SUBJECT,
	},
});

push.registerLocation('fcm', {
	driver: 'fcm',
	options: {
		serviceAccount: env.PUSH_FCM_SERVICE_ACCOUNT,
	},
});

push.registerRoutes({
	webpush: 'webpush',
	fcm: 'fcm',
});
```

Anywhere later:

```ts
import { PushTargetGoneError, sendPush } from '@novastarter/push';

// As the browser handed it out (`PushSubscription.toJSON()`) and the app stored it
const subscription = {
	endpoint: 'https://…',
	keys: {
		p256dh: '…',
		auth: '…',
	},
};

try {
	const result = await sendPush({
		subscription,
		title: 'Invoice paid',
		body: 'Invoice #1042 — $49.00',
		url: '/dashboard/billing/invoices',
		tag: 'invoice-1042',
	});
	// → { location: 'webpush', platform: 'webpush', status: '201' }
} catch (error) {
	// The push service no longer knows the subscription: delete it, do not retry
	if (error instanceof PushTargetGoneError) await deleteSubscription(subscription.endpoint);
}
```

A message is
`{ subscription | token, platform?, location?, title, body?, url?, icon?, image?, badge?, tag?, data?, ttl?, urgency? }`:
exactly one target — a token names its `platform` (`fcm` unless it says `apns`; the stored device knows) — and the
location the target was registered with, when the routes do not say. The VAPID public key a browser subscribes with is
`usePush().location('webpush').applicationServerKey`.

`registerLocation()` checks that the driver exists and keeps the options; the first use builds the driver, so an unused
location never opens a client and a bad configuration surfaces on the first send. `location(name)` hands the driver
itself out — `usePush().location('fcm').send(message)` skips the routes — and throws for a name nobody registered;
`hasLocation(name)` and `locationNames()` inspect the registry, `instantiated()` lists what was built so far.
`registerRoutes()` replaces the routes whole; `routes()` reads them back. `close()` releases the connections of the
drivers built so far — the FCM app, the APNs HTTP/2 sessions — for a clean shutdown.

## Sending

`sendPush(message, { location? })` does, for every message:

1. Refuses a message without a title, without a target, with both targets, or with a subscription missing its `https:`
   endpoint or its `p256dh` / `auth` keys (`InvalidPayloadError`).
2. Runs the `push.send` filter of `@novastarter/emitter` — a handler may rewrite the message (a redirect to a test
   device) or return `null` to drop it; `sendPush()` then answers `null`. The rewrite is checked like the original and
   routed by its own target, so a subscription redirected to a token goes through the token's location.
3. Picks the location: the option, else the message's `location`, else the route of the target's platform, else the
   location named after the platform (`webpush`, `fcm`, `apns`). A name nobody registered, or one whose driver does not
   deliver to the platform, throws. There is no fallback chain — a browser subscription only works with the VAPID key
   pair it was created for, a token only with its Firebase project or its Apple app, so a second location could not take
   a target the first one refused.
4. Sends. `push.sent` is emitted with the result; a `PushTargetGoneError` from the driver is emitted as `push.gone` (a
   listener deletes the stored subscription) and passed on; any other failure is emitted as `push.failed` and thrown as
   an `Error` with the driver's error as `cause`.

The routes name the location of each platform:

```ts
usePush().registerRoutes({
	webpush: 'web',
	fcm: 'android',
	apns: 'ios',
});
```

With one location per platform named after it, no routes are needed at all.

## Web push payload

The `webpush` driver posts the JSON of `toWebPushPayload(message)`, and the app's service worker shows it:

```js
self.addEventListener('push', (event) => {
	// { title, body, icon, image, badge, tag, data: { url, … } }
	const { title, ...options } = event.data.json();

	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	event.waitUntil(clients.openWindow(event.notification.data.url ?? '/'));
});
```

A web push payload is capped at 4 KB by the push services; `data` should stay small.

## Configuration

The package reads nothing from the environment; the variable names, their defaults and their `_FILE` variants are the
application's schema's — see `@novastarter/env`.

## Drivers

`console` writes the message to the application log, for every platform; the zero-config transport.

| Option   | Required | Description                                              |
| -------- | -------- | -------------------------------------------------------- |
| `logger` | —        | Logger to write to; the application logger unless given. |

## Any other request

A driver may implement `call(method, params, options)`: a request of its provider's own API with the location's
credentials, timeout and errors, for whatever the contract does not cover. `method` is the verb and path of a REST API
(`POST /v1/refunds`), a full URL on one of the provider's own hosts, or the command name of an RPC-style SDK; the
parameters are the query of a `GET`/`HEAD`/`DELETE` and the body otherwise; `options` takes a `timeout`, a `signal` and
extra `headers` — a `content-type` among them picks JSON, a form or multipart. The answer is
`{ status, headers, data }`: the headers lower-cased, the provider's JSON, or its text. An error status throws
`ProviderCallError` of `@novastarter/errors`, with the provider's status and answer in `extensions`; a 429 throws
`HitRateLimitError`. Each driver's readme names its endpoints and hosts.

```ts
await usePush()
	.location('fcm')
	.call?.('POST https://iid.googleapis.com/iid/v1:batchAdd', { to: '/topics/news', registration_tokens: [token] });
```

The `console` driver logs the call; `webpush` and `apns` have one endpoint each and no `call()`.

A `{name}` in the path is filled from the parameter of that name and not sent again; headers and a timeout for every
call of a location go in its registration's `call`:

```ts
usePush().registerLocation('fcm', {
	driver: 'fcm',
	options: { serviceAccount: env.FCM_SERVICE_ACCOUNT },
	call: { timeout: 10_000 },
});

const { status, headers, data } = await usePush().location('fcm').call!(
	'POST https://iid.googleapis.com/iid/v1:batchAdd',
	{ to: '/topics/news', registration_tokens: [token] },
);
```

## Writing a driver

A driver is a class taking its options in the constructor and implementing `PushDriver` from this package — `platforms`
(what it delivers to), `send()`, and `verify()` when the provider can check credentials without sending, `close()` when
its SDK keeps connections open; see `@novastarter/push-driver-webpush` for the smallest one. `platformOf()` tells a
message's platform from its target, `toWebPushPayload()` serves a driver that posts to a browser's push service. A dead
target — the push service says the subscription or token no longer exists — is thrown as `PushTargetGoneError`, so the
caller deletes it. The package registers its options in the driver map, so a location naming it is type-checked:

```ts
declare module '@novastarter/push' {
	interface PushDrivers {
		onesignal: PushDriverOneSignalConfig;
	}
}
```
