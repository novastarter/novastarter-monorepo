# `@novastarter/sms`

SMS abstraction layer for Novastarter.

## Installation

```
pnpm add @novastarter/sms @novastarter/sms-driver-twilio
```

One driver package per provider: `sms-driver-twilio`, `sms-driver-vonage`. The `console` driver ships inside this
package.

## Usage

At start-up, once — vendor drivers as classes, locations as explicit options, then the routes; a driver is built on the
location's first use. The same driver can back several locations with different credentials, and `driver` decides the
type of `options`; `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useSms } from '@novastarter/sms';
import { SmsDriverTwilio } from '@novastarter/sms-driver-twilio';
import { SmsDriverVonage } from '@novastarter/sms-driver-vonage';
import { env } from './env';

const sms = useSms();

sms.registerDriver('twilio', SmsDriverTwilio);
sms.registerDriver('vonage', SmsDriverVonage);

sms.registerLocation('main', {
	driver: 'twilio',
	options: {
		accountSid: env.SMS_TWILIO_ACCOUNT_SID,
		authToken: env.SMS_TWILIO_AUTH_TOKEN,
	},
});

sms.registerLocation('backup', {
	driver: 'vonage',
	options: {
		apiKey: env.SMS_VONAGE_API_KEY,
		apiSecret: env.SMS_VONAGE_API_SECRET,
	},
});

sms.registerRoutes({
	from: env.SMS_FROM,
	transactional: ['main', 'backup'],
});
```

Anywhere later:

```ts
import { sendSms } from '@novastarter/sms';

const result = await sendSms({
	to: '+14155550123',
	text: 'Your code is 123456',
});
// → { location: 'main', messageId: 'SM…', status: 'queued', segments: 1 }
```

A message is `{ to, text, from?, category?, ttl?, reference? }`: the recipient in E.164, the text as it goes out — the
application renders, this package sends — and a sender that is a number or, where the destination allows one, an
alphanumeric sender id.

`registerLocation()` checks that the driver exists and keeps the options; the first use builds the driver, so an unused
location never opens a client and a bad configuration surfaces on the first send. `location(name)` hands the driver
itself out — `useSms().location('main').send(message)` skips the routes — and throws for a name nobody registered;
`hasLocation(name)` and `locationNames()` inspect the registry, `instantiated()` lists what was built so far, `close()`
releases the drivers built so far at shutdown and keeps the registrations. `registerRoutes()` replaces the routes whole;
`routes()` reads them back.

## Sending

`sendSms(message, { location? })` does, for every message:

1. Cleans the recipient up — spaces, dashes, dots, parentheses and a `00` prefix — and refuses one that is not E.164
   afterwards, or a text that is blank (`InvalidPayloadError`). A bare national number is refused rather than guessed a
   country for.
2. Runs the `sms.send` filter of `@novastarter/emitter` — a handler may rewrite the message or return `null` to drop it.
   The rewrite is checked like the original, so a redirect to a malformed test number fails here rather than at a
   provider.
3. Fills `from` in from the routes. A message may still go out without one: a Twilio location with a messaging service
   supplies the sender itself, and a driver that needs one refuses by name.
4. Picks the chain: `transactional` / `marketing` by `category`; without routes every location in registration order is
   the chain. Names the manager does not know are dropped, and a rule left with no name at all is passed over.
5. Tries the chain in order. A location whose limiter is spent is skipped, and so is one whose driver throws (logged as
   a warning).
6. Emits `sms.sent` with the location and the result, or `sms.failed` and throws: the limiter's `HitRateLimitError` when
   the limit was all that stood in the way, otherwise an `Error` with the last failure as `cause`.

An explicit `location` short-circuits the routes; it has to be registered, a name nobody registered throws before
anything is sent or logged. The routes carry everything the chain needs:

```ts
import { useLimiter } from '@novastarter/memory';

useSms().registerRoutes({
	from: env.SMS_FROM,
	transactional: ['main', 'backup'],
	marketing: ['bulk'],
	limiters: {
		main: useLimiter().location('sms-main'),
	},
});
```

A limiter is any `LimiterDriver` of `@novastarter/memory`; the location name is its key, so the budget is per location.

Sending from a request is the application's job, not the package's: the app declares an `sms.send` contract with
`@novastarter/queue` and a handler that turns the payload into a message and calls `sendSms()` — see
`apps/web/jobs/sms-send.ts` in the kit.

## Phone numbers

`normalizePhoneNumber(value)` drops separators and turns a leading `00` into `+`; `isPhoneNumber(value)` checks the
result is E.164 (`+`, then 2 to 15 digits, the first not `0`). `sendSms()` runs both, and an application's own
validation — a sign-up form, a job payload — uses them so the rules match.

## Configuration

The package reads nothing from the environment; the variable names, their defaults and their `_FILE` variants are the
application's schema's — see `@novastarter/env`.

## Drivers

`console` writes the message to the application log; the zero-config transport, with the one-time code readable in the
terminal.

| Option   | Required | Description                                              |
| -------- | -------- | -------------------------------------------------------- |
| `logger` | —        | Logger to write to; the application logger unless given. |

## Writing a driver

A driver is a class taking its options in the constructor and implementing `SmsDriver` from this package — `send()`,
`verify()` when the provider can check credentials without sending, `close()` when the SDK keeps connections open; see
`@novastarter/sms-driver-vonage` for the smallest one. The package registers its options in the driver map, so a
location naming it is type-checked:

```ts
declare module '@novastarter/sms' {
	interface SmsDrivers {
		messagebird: SmsDriverMessagebirdConfig;
	}
}
```
