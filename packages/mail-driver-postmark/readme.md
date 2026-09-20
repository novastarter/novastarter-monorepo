# `@novastarter/mail-driver-postmark`

Postmark driver for `@novastarter/mail`.

## Installation

```
pnpm add @novastarter/mail @novastarter/mail-driver-postmark
```

## Usage

Register the class once at start-up, then a location per server with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useMail } from '@novastarter/mail';
import { MailDriverPostmark } from '@novastarter/mail-driver-postmark';
import { env } from './env';

const mail = useMail();

mail.registerDriver('postmark', MailDriverPostmark);

mail.registerLocation('main', {
	driver: 'postmark',
	options: {
		serverToken: env.MAIL_POSTMARK_SERVER_TOKEN,
		broadcastStream: 'newsletter',
	},
});
```

Anywhere later: `sendMail(message)` routes through the location, or `useMail().location('main').send(message)` skips the
routes.

Through the official `postmark` SDK. Postmark takes one tag per message — the first of ours; the category and the
remaining tags go to `Metadata`. `marketing` mail goes to `broadcastStream` when there is one. `verify()` reads the
server the token belongs to.

## Options

| Option            | Required | Description                                                                                 |
| ----------------- | -------- | ------------------------------------------------------------------------------------------- |
| `serverToken`     | yes      | Server API token from the Postmark server's "API Tokens" tab.                               |
| `messageStream`   | —        | Message stream transactional mail goes to; Postmark's default (`outbound`) unless given.    |
| `broadcastStream` | —        | Message stream `marketing` mail goes to — a broadcast stream; `messageStream` unless given. |
| `timeout`         | —        | Request timeout in seconds; the SDK's default unless given.                                 |
