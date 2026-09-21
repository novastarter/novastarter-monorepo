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

## Options

| Option     | Required | Description                                                                                                                  |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`   | yes      | Private API key from the Mailgun dashboard.                                                                                  |
| `domain`   | yes      | Sending domain the messages go out from (`mg.example.com`).                                                                  |
| `host`     | —        | API host: `api.mailgun.net` (the default) for the US region, `api.eu.mailgun.net` for the EU one; a full URL is taken as is. |
| `testMode` | —        | Accept the messages without delivering them — Mailgun's test mode (`o:testmode`).                                            |
| `timeout`  | —        | Request timeout in milliseconds; the SDK's default unless given.                                                             |
