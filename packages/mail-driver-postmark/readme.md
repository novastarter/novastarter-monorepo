# `@novastarter/mail-driver-postmark`

Postmark mail driver for `@novastarter/mail`.

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
remaining tags go to `Metadata`, the tags comma-joined and spread over `tags`, `tags2`, … so no value passes Postmark's
80-character limit (a longer tag is cut to it; tags past the nine fields left are dropped). `marketing` mail goes to
`broadcastStream` when there is one. `verify()` reads the server the token belongs to.

## Any other request

`call()` makes a request of the [Postmark API](https://postmarkapp.com/developer/api/overview) with the location's
server token — a `GET`'s parameters go in the query, the rest as JSON. A refusal throws `ProviderCallError` with
Postmark's `ErrorCode` and `Message` in `extensions.body` (`HitRateLimitError` on a 429); the timeout is the location's
`timeout`, 30 s unless set.

```ts
const mail = useMail().location('main');

const bounces = await mail.call?.('GET /bounces', { count: 50, offset: 0, type: 'HardBounce' });

await mail.call?.('PUT /bounces/692560173/activate');
```

A path is joined to `https://api.postmarkapp.com`; a full URL may only point at `api.postmarkapp.com`. The server token
is sent, so endpoints of the account API, which need an account token, are refused by Postmark.

## Options

| Option            | Required | Description                                                                                 |
| ----------------- | -------- | ------------------------------------------------------------------------------------------- |
| `serverToken`     | yes      | Server API token from the Postmark server's "API Tokens" tab.                               |
| `messageStream`   | —        | Message stream transactional mail goes to; Postmark's default (`outbound`) unless given.    |
| `broadcastStream` | —        | Message stream `marketing` mail goes to — a broadcast stream; `messageStream` unless given. |
| `timeout`         | —        | Request timeout in seconds; the SDK's default unless given.                                 |
