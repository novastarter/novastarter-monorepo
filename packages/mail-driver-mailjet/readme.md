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
