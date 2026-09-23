# `@novastarter/mail-driver-mailgun`

Mailgun mail driver for `@novastarter/mail`.

## Installation

```
pnpm add @novastarter/mail @novastarter/mail-driver-mailgun
```

## Usage

Register the class once at start-up, then a location per sending domain with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useMail } from '@novastarter/mail';
import { MailDriverMailgun } from '@novastarter/mail-driver-mailgun';
import { env } from './env';

const mail = useMail();

mail.registerDriver('mailgun', MailDriverMailgun);

mail.registerLocation('main', {
	driver: 'mailgun',
	options: {
		apiKey: env.MAIL_MAILGUN_API_KEY,
		domain: env.MAIL_MAILGUN_DOMAIN,
		host: 'api.eu.mailgun.net',
	},
});
```

Anywhere later: `sendMail(message)` routes through the location, or `useMail().location('main').send(message)` skips the
routes.

Messages API through the official `mailgun.js` SDK (Node's own `FormData`): the category and the tags become Mailgun
tags (`o:tag`), the reply-to and the custom headers `h:` fields; attachments with a content id go to `inline` and are
referenced from the html as `cid:<content id>`, the rest to `attachment`. A refusal of the API throws with the provider
named and the SDK's `APIError` as the cause, so `sendMail()` falls back. `verify()` reads the domain and requires it to
be `active`.

## Any other request

`call()` makes a request of the [Mailgun API](https://documentation.mailgun.com/docs/mailgun/api-reference/) with the
location's key, on the location's host; `{domain}` in the path is the location's domain. The parameters of a `GET`,
`HEAD` or `DELETE` go in the query, the body otherwise, as a form (multipart when a `Blob` or `File` is among them), a
list repeating its key. A refusal throws `ProviderCallError` (`HitRateLimitError` on a 429); the timeout is the
location's `timeout`, 30 s unless set. It answers `{ status, headers, data }`.

```ts
const mail = useMail().location('main');

const { data: events } = await mail.call!('GET /v3/{domain}/events', { event: 'failed', limit: 50 });

await mail.call!('POST /v3/{domain}/unsubscribes', { address: 'ada@example.com', tag: '*' });
```

A `{name}` in the path takes the parameter of that name, URL-encoded, and that parameter is not sent again; `{domain}`
is filled from a `domain` parameter first, the location's domain otherwise:

```ts
const { status, data } = await mail.call!('GET /v3/{domain}/bounces/{address}', { address: 'ada@example.com' });
```

A path is joined to the location's host (`https://api.mailgun.net` unless `host` is set); a full URL may only point at
that host — `api.mailgun.net` or `api.eu.mailgun.net`, whichever the location uses.

## Options

| Option     | Required | Description                                                                                                                  |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`   | yes      | Private API key from the Mailgun dashboard.                                                                                  |
| `domain`   | yes      | Sending domain the messages go out from (`mg.example.com`).                                                                  |
| `host`     | —        | API host: `api.mailgun.net` (the default) for the US region, `api.eu.mailgun.net` for the EU one; a full URL is taken as is. |
| `testMode` | —        | Accept the messages without delivering them — Mailgun's test mode (`o:testmode`).                                            |
| `timeout`  | —        | Request timeout in milliseconds; the SDK's default unless given.                                                             |
