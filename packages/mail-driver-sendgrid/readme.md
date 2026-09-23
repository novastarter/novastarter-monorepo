# `@novastarter/mail-driver-sendgrid`

SendGrid mail driver for `@novastarter/mail`.

## Installation

```
pnpm add @novastarter/mail @novastarter/mail-driver-sendgrid
```

## Usage

Register the class once at start-up, then a location per API key with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useMail } from '@novastarter/mail';
import { MailDriverSendgrid } from '@novastarter/mail-driver-sendgrid';
import { env } from './env';

const mail = useMail();

mail.registerDriver('sendgrid', MailDriverSendgrid);

mail.registerLocation('main', {
	driver: 'sendgrid',
	options: {
		apiKey: env.MAIL_SENDGRID_API_KEY,
	},
});
```

Anywhere later: `sendMail(message)` routes through the location, or `useMail().location('main').send(message)` skips the
routes.

Through the official `@sendgrid/mail` SDK on a client of the location's own, so two keys never share state; the category
and the tags become SendGrid categories, attachments go base64-encoded, inline when they carry a content id.

## Any other request

`call()` makes a request of the [SendGrid v3 API](https://www.twilio.com/docs/sendgrid/api-reference) with the
location's key — the parameters of a `GET`, `HEAD` or `DELETE` go in the query, the rest as JSON. A refusal throws
`ProviderCallError` with SendGrid's `errors` in `extensions.body` (`HitRateLimitError` on a 429). The default timeout is
30 s; a timeout or an abort stops the request itself, and a signal aborted before the call sends nothing.
`paramsIn: 'body'` sends a `DELETE`'s parameters as JSON, for the bulk removals:

```ts
const mail = useMail().location('main');

const bounces = await mail.call?.('GET /v3/suppression/bounces', { start_time: 1_700_000_000 });

await mail.call?.('POST /v3/asm/suppressions/global', { recipient_emails: ['ada@example.com'] });

await mail.call?.('DELETE /v3/suppression/bounces', { emails: ['ada@example.com'] }, { paramsIn: 'body' });
```

A path is joined to `https://api.sendgrid.com`; a full URL may only point at `api.sendgrid.com`. The key needs the
permission of the endpoint it calls.

## Options

| Option    | Required | Description                                            |
| --------- | -------- | ------------------------------------------------------ |
| `apiKey`  | yes      | API key with the `Mail Send` permission (`SG.…`).      |
| `sandbox` | —        | Validate without delivering — SendGrid's sandbox mode. |
