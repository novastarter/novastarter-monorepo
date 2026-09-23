# `@novastarter/mail`

Outgoing mail abstraction layer for Novastarter.

## Installation

```
pnpm add @novastarter/mail @novastarter/mail-driver-ses
```

One driver package per provider: `mail-driver-ses`, `mail-driver-sendgrid`, `mail-driver-resend`,
`mail-driver-postmark`, `mail-driver-mailtrap`, `mail-driver-mailjet`, `mail-driver-mailgun`. The `console`, `file`,
`sendmail` and `smtp` drivers ship inside this package.

## Usage

At start-up, once — vendor drivers as classes, locations as explicit options, then the routes; a driver is built on the
location's first use. The same driver can back several locations with different credentials, and `driver` decides the
type of `options`; `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useMail } from '@novastarter/mail';
import { MailDriverSes } from '@novastarter/mail-driver-ses';
import { env } from './env';

const mail = useMail();

mail.registerDriver('ses', MailDriverSes);

mail.registerLocation('main', {
	driver: 'ses',
	options: {
		region: env.MAIL_SES_REGION,
		accessKeyId: env.MAIL_SES_ACCESS_KEY_ID,
		secretAccessKey: env.MAIL_SES_SECRET_ACCESS_KEY,
	},
});

mail.registerLocation('backup', {
	driver: 'smtp',
	options: {
		host: env.MAIL_SMTP_HOST,
		port: env.MAIL_SMTP_PORT,
		user: env.MAIL_SMTP_USER,
		password: env.MAIL_SMTP_PASSWORD,
	},
});

mail.registerRoutes({
	from: {
		name: 'Acme',
		address: env.MAIL_FROM,
	},
	transactional: ['main', 'backup'],
});
```

Anywhere later:

```ts
import { sendMail } from '@novastarter/mail';

const result = await sendMail({
	to: {
		name: 'Ada',
		address: 'ada@example.com',
	},
	subject: 'Welcome',
	html: '<p>Hello</p>',
	text: 'Hello',
	category: 'transactional',
});
// → { location: 'main', messageId, accepted, rejected }
```

`registerLocation()` checks that the driver exists and keeps the options; the first use builds the driver, so an unused
location never opens a client and a bad configuration surfaces on the first send. `location(name)` hands the driver
itself out — `useMail().location('main').send(message)` skips the routes — and throws for a name nobody registered;
`hasLocation(name)` and `locationNames()` inspect the registry, `instantiated()` lists what was built so far, `close()`
releases the drivers built so far at shutdown — the pooled SMTP connections, say — and keeps the registrations.
`registerRoutes()` replaces the routes whole; `routes()` reads them back.

## Sending

`sendMail(message, { location? })` does, for every message:

1. Runs the `mail.send` filter of `@novastarter/emitter` — a handler may rewrite the message or return `null` to drop
   it.
2. Fills `from` in from the routes; an object `from` must carry both `name` and `address`, and a message without any
   sender throws `InvalidPayloadError`.
3. Trims the html line by line — some clients misbehave past 75 characters of leading whitespace.
4. Picks the chain: `domains` by the sender's domain wins over `transactional` / `marketing` by `category`; without
   routes every location in registration order is the chain. Names the manager does not know are dropped, and a rule
   left with no name at all is passed over for the next one.
5. Tries the chain in order. A location whose limiter is spent is skipped, and so is one whose driver throws (logged as
   a warning).
6. Emits `mail.sent` with the location and the result, or `mail.failed` and throws: the limiter's `HitRateLimitError`
   when the limit was all that stood in the way, otherwise an `Error` with the last failure as `cause`.

An explicit `location` short-circuits the routes; it has to be registered, a name nobody registered throws before
anything is sent or logged. The routes carry everything the chain needs:

```ts
import { useLimiter } from '@novastarter/memory';

useMail().registerRoutes({
	from: env.MAIL_FROM,
	transactional: ['main', 'backup'],
	marketing: ['bulk'],
	domains: {
		'news.acme.com': ['bulk'],
	},
	limiters: {
		main: useLimiter().location('mail-main'),
	},
});
```

A limiter is any `LimiterDriver` of `@novastarter/memory`; the location name is its key, so the budget is per location.

Sending from a request is the application's job, not the package's: the app declares a `mail.send` contract with
`@novastarter/queue` and a handler that turns the payload into a message and calls `sendMail()` — see
`apps/web/jobs/mail-send.ts` in the kit.

## Configuration

The package reads nothing from the environment; the variable names, their defaults and their `_FILE` variants are the
application's schema's — see `@novastarter/env`.

## Drivers

`console` writes the message to the application log; the zero-config transport.

| Option        | Required | Description                                              |
| ------------- | -------- | -------------------------------------------------------- |
| `logger`      | —        | Logger to write to; the application logger unless given. |
| `includeHtml` | —        | Include the html body in the log line; off by default.   |

`file` writes the complete RFC 822 message (`.eml`, attachments included), for tests and for opening a rendered message
in a mail client.

| Option | Required | Description                                              |
| ------ | -------- | -------------------------------------------------------- |
| `dir`  | yes      | Directory the `.eml` files go to, created on first send. |

`sendmail` pipes messages to the host's `sendmail` binary.

| Option    | Required | Description                                                            |
| --------- | -------- | ---------------------------------------------------------------------- |
| `path`    | —        | The binary; `/usr/sbin/sendmail` unless given.                         |
| `newLine` | —        | Line endings piped to it: `unix` unless given, `windows` for Exchange. |

`smtp` sends through any SMTP server with nodemailer.

| Option             | Required | Description                                                                            |
| ------------------ | -------- | -------------------------------------------------------------------------------------- |
| `host`             | yes      | The server.                                                                            |
| `port`             | —        | 587 unless given (465 with `secure`).                                                  |
| `secure`           | —        | TLS from the first byte, as opposed to STARTTLS; on unless given when the port is 465. |
| `ignoreTls`        | —        | Do not upgrade to TLS even when the server offers it.                                  |
| `user`, `password` | —        | Credentials; set together, or neither for an open relay.                               |
| `name`             | —        | Hostname sent in `HELO`.                                                               |
| `pool`             | —        | Keep connections open between messages.                                                |
| `tls`              | —        | Node TLS options, passed straight through.                                             |

## Any other request

A driver may implement `call(method, params, options)`: a request of its provider's own API with the location's
credentials, timeout and errors, for whatever the contract does not cover. `method` is the verb and path of a REST API
(`POST /v1/refunds`), a full URL on one of the provider's own hosts, or the command name of an RPC-style SDK; the
parameters are the query of a `GET`/`HEAD`/`DELETE` and the body otherwise; `options` takes a `timeout`, a `signal`,
extra `headers` and `paramsIn` — `'body'` for an API that reads a `DELETE` body. A `content-type` among the headers
picks the body's form: a form, multipart, or the `body` parameter as it is for XML or plain text. The answer is the
provider's JSON, or its text. An error status throws `ProviderCallError` of `@novastarter/errors`, with the provider's
status and answer in `extensions`; a 429 throws `HitRateLimitError`. Each driver's readme names its endpoints and hosts.

```ts
await useMail().location('resend').call?.('GET /domains');
```

The `console` driver logs the call; `smtp`, `sendmail` and `file` have no API and no `call()`.

## Writing a driver

A driver is a class taking its options in the constructor and implementing `MailDriver` from this package — `send()`,
`verify()` when the provider can check credentials without sending, `close()` when the SDK keeps connections open; see
`@novastarter/mail-driver-resend` for the smallest one. `toNodemailerMessage()` / `toMailResult()` serve a nodemailer
transport, `readAttachment()` an API that takes the bytes inline. The package registers its options in the driver map,
so a location naming it is type-checked:

```ts
declare module '@novastarter/mail' {
	interface MailDrivers {
		brevo: MailDriverBrevoConfig;
	}
}
```
