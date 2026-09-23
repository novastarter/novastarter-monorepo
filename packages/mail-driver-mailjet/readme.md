# `@novastarter/mail-driver-mailjet`

Mailjet mail driver for `@novastarter/mail`.

## Installation

```
pnpm add @novastarter/mail @novastarter/mail-driver-mailjet
```

## Usage

Register the class once at start-up, then a location per key pair with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useMail } from '@novastarter/mail';
import { MailDriverMailjet } from '@novastarter/mail-driver-mailjet';
import { env } from './env';

const mail = useMail();

mail.registerDriver('mailjet', MailDriverMailjet);

mail.registerLocation('main', {
	driver: 'mailjet',
	options: {
		apiKey: env.MAIL_MAILJET_API_KEY,
		apiSecret: env.MAIL_MAILJET_API_SECRET,
	},
});
```

Anywhere later: `sendMail(message)` routes through the location, or `useMail().location('main').send(message)` skips the
routes.

Through the official `node-mailjet` SDK, Send API v3.1; the category becomes `CustomCampaign`, the tags `CustomID`,
which Mailjet's statistics group by. A message Mailjet answers with `Status: 'error'` throws with its errors listed, so
`sendMail()` falls back.

## Options

| Option      | Required | Description                                           |
| ----------- | -------- | ----------------------------------------------------- |
| `apiKey`    | yes      | Public API key.                                       |
| `apiSecret` | yes      | Private API key.                                      |
| `sandbox`   | —        | Validate without delivering — Mailjet's sandbox mode. |

## Any other request

`call()` makes a request of Mailjet's own API with the location's key pair — the way to contacts, lists, statistics and
anything else the driver has no wrapper for. The method is the verb and a path from `https://api.mailjet.com`, the API
version included; the parameters are the query of a `GET`, `HEAD` or `DELETE` and the JSON body otherwise. It answers
`{ status, headers, data }`.

```ts
const mail = useMail().location('main');

const { data: contacts } = await mail.call!('GET /v3/REST/contact', { Limit: 10 });

await mail.call!('POST /v3/REST/contactslist', { Name: 'Newsletter' });
```

A `{name}` in the path takes the parameter of that name, URL-encoded, and that parameter is not sent again:

```ts
const { status, data } = await mail.call!('GET /v3/REST/contact/{id}', { id: 'ada@example.com' });
```

A full URL may point at `api.mailjet.com` or, for the US region, `api.us.mailjet.com` only; any other host is refused
before the request, so the key pair never leaves Mailjet. An error status throws `ProviderCallError` with Mailjet's
status and answer, a 429 `HitRateLimitError`; the timeout is 30 seconds unless `{ timeout }` names another.
