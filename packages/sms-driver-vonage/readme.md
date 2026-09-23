# `@novastarter/sms-driver-vonage`

Vonage SMS driver for `@novastarter/sms`.

## Installation

```
pnpm add @novastarter/sms @novastarter/sms-driver-vonage
```

## Usage

Register the class once at start-up, then a location per API key with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useSms } from '@novastarter/sms';
import { SmsDriverVonage } from '@novastarter/sms-driver-vonage';
import { env } from './env';

const sms = useSms();

sms.registerDriver('vonage', SmsDriverVonage);

sms.registerLocation('main', {
	driver: 'vonage',
	options: {
		apiKey: env.SMS_VONAGE_API_KEY,
		apiSecret: env.SMS_VONAGE_API_SECRET,
	},
});
```

Anywhere later: `sendSms(message)` routes through the location, or `useSms().location('main').send(message)` skips the
routes.

Through the `@vonage/sms` package, the SMS product of the SDK on its own — the whole `@vonage/server-sdk` would pull in
every other product for one endpoint. Vonage writes numbers without the leading `+`, which the driver strips, and takes
`ttl` in milliseconds where ours is in seconds. Every message needs a `from`: Vonage has no account-wide sender to fall
back on, so a message without one is refused by name rather than by the API.

Vonage does not detect the encoding itself, so the driver does: a text made only of GSM 03.38 characters goes out as
`text`, and one character outside it — Cyrillic, an emoji, a dash that is not a hyphen — sends the whole message as
`unicode` (UCS-2), which halves the characters per part but arrives readable.

A refusal is answered with HTTP `200` and a status per part of the message; the SDK turns that into an `SMSFailure`,
which the driver reports as a throw naming Vonage's status — `4` for bad credentials, `15` for a sender the destination
does not allow — and its wording, with the SDK error as the `cause`, so `sendSms()` falls back to the next location and
the whole answer stays reachable.

`verify()` reads the account balance over `rest.nexmo.com`: nothing is created, and no second SDK is needed for it.

## Any other request

`call(method, params, options)` reaches the rest of Vonage's APIs through the SDK's client, with the location's key pair
as a Basic `Authorization` header, its timeout and the kit's errors. A path goes under `https://rest.nexmo.com`; the
parameters are the query of a `GET`, `HEAD` or `DELETE` and a JSON body otherwise (`options.paramsIn` moves them, a
`content-type: application/x-www-form-urlencoded` header sends a form instead; any other content type is refused).

```ts
const vonage = useSms().location('main');

const balance = await vonage.call?.('GET /account/get-balance');

const pricing = await vonage.call?.('GET /account/get-pricing/outbound/sms', { country: 'GB' });
```

A file — a `Blob` or `File` among the parameters, or in a list — goes as a multipart body, for an endpoint that takes
one; the SDK's client sends no multipart, so that request is made directly, with the same key pair, host check, timeout
and errors. Vonage's messaging APIs take media by URL, so most calls need no upload at all.

A full URL may point at `rest.nexmo.com`, `api.nexmo.com`, `api.vonage.com`, `api-eu.vonage.com`, `api-us.vonage.com`
and `api-ap.vonage.com` only; any other host is refused before the key pair is sent. An error status throws
`ProviderCallError` with Vonage's answer in `extensions.body`, a `429` throws `HitRateLimitError`, and the timeout
`TimeoutError`.

## Options

| Option      | Required | Description                                                                               |
| ----------- | -------- | ----------------------------------------------------------------------------------------- |
| `apiKey`    | yes      | API key from the Vonage dashboard.                                                        |
| `apiSecret` | yes      | API secret of that key.                                                                   |
| `timeout`   | —        | How long a request may take, in milliseconds; the SDK waits without a limit unless given. |
