# `@novastarter/sms-driver-twilio`

Twilio SMS driver for `@novastarter/sms`.

## Installation

```
pnpm add @novastarter/sms @novastarter/sms-driver-twilio
```

## Usage

Register the class once at start-up, then a location per account with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useSms } from '@novastarter/sms';
import { SmsDriverTwilio } from '@novastarter/sms-driver-twilio';
import { env } from './env';

const sms = useSms();

sms.registerDriver('twilio', SmsDriverTwilio);

sms.registerLocation('main', {
	driver: 'twilio',
	options: {
		accountSid: env.SMS_TWILIO_ACCOUNT_SID,
		apiKey: env.SMS_TWILIO_API_KEY,
		apiSecret: env.SMS_TWILIO_API_SECRET,
	},
});
```

Anywhere later: `sendSms(message)` routes through the location, or `useSms().location('main').send(message)` skips the
routes.

Through the official `twilio` SDK. An API key pair is preferred over the account's auth token, since a key can be
revoked on its own; either one authenticates the same account. A message without a `from` is sent through the location's
`messagingServiceSid`, which picks a sender from its pool, and a message that names one keeps it — so one location
serves both. `ttl` becomes Twilio's `validityPeriod`, in seconds.

A refused request is reported as a throw naming Twilio's HTTP status, its own error code — `21211` for an unusable
number, `21610` for a recipient who unsubscribed — and the help URL, with the SDK's error as the `cause`, so `sendSms()`
falls back to the next location and the caller can still read the code. Twilio also answers `201` for a message it
already knows it cannot deliver; such an answer carries an `errorCode` and is thrown too, rather than reported as sent.

`verify()` reads the account balance: the cheapest authenticated request there is, and nothing is billed.

## Any other request

`call(method, params, options)` reaches the rest of Twilio's APIs through the SDK's client, with the location's
credentials, timeout and errors, and answers `{ status, headers, data }`. A path goes under `https://api.twilio.com`,
where `{AccountSid}` stands for the location's account; the parameters are the query of a `GET`, `HEAD` or `DELETE` and
a form body otherwise (a `content-type: application/json` header, in any case, sends JSON instead; no other type is
sent). A file is refused: the SDK's client sends no multipart body.

```ts
const twilio = useSms().location('main');

const { data: message } = await twilio.call!('GET /2010-04-01/Accounts/{AccountSid}/Messages/SM123.json');

const { data: lookup } = await twilio.call!('GET https://lookups.twilio.com/v2/PhoneNumbers/+15558675310', {
	Fields: 'line_type_intelligence',
});
```

A full URL may point at `*.twilio.com` only — `api`, `lookups`, `verify`, `messaging` and the other product hosts; any
other host is refused before the credentials are sent. An error status throws `ProviderCallError` with Twilio's
`{ code, message, more_info }` in `extensions.body`, a `429` throws `HitRateLimitError`, and the timeout `TimeoutError`.
A network failure throws a plain `Error` naming its code — never the SDK's error, whose request config carries the
credentials.

Another `{name}` in the path is filled from the parameter of that name, URL-encoded, and that parameter is not sent
again; a `{name}` no parameter fills is refused before a request. The headers carry Twilio's `twilio-request-id`, say.

```ts
const twilio = useSms().location('main');

const { status, headers, data } = await twilio.call!<{ status: string }>(
	'GET /2010-04-01/Accounts/{AccountSid}/Messages/{sid}.json',
	{ sid: 'SM123' },
);

console.log(status, data.status, headers['twilio-request-id']);
```

## The SDK client

`call()` covers plain requests only. For the rest — typed resources, paging — the driver's `client` is the SDK's own
Twilio client, on the location's credentials and timeout:

```ts
import type { SmsDriverTwilio } from '@novastarter/sms-driver-twilio';

const twilio = useSms().location('main') as SmsDriverTwilio;

const messages = await twilio.client.messages.list({ to: '+15558675310', limit: 50 });
```

## Options

| Option                | Required | Description                                                                         |
| --------------------- | -------- | ----------------------------------------------------------------------------------- |
| `accountSid`          | yes      | Account SID from the Twilio console (`AC…`).                                        |
| `authToken`           | —        | Auth token of the account; the alternative to an API key pair.                      |
| `apiKey`, `apiSecret` | —        | API key SID (`SK…`) and its secret; set together, instead of the token.             |
| `messagingServiceSid` | —        | Messaging service (`MG…`) that supplies the sender of a message that has no `from`. |
| `statusCallback`      | —        | URL Twilio posts delivery status updates to.                                        |
| `timeout`             | —        | How long a request may take, in milliseconds; the SDK's 30 s unless given.          |
