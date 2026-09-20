# `@novastarter/mail-driver-sendgrid`

SendGrid driver for `@novastarter/mail`.

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

## Options

| Option    | Required | Description                                            |
| --------- | -------- | ------------------------------------------------------ |
| `apiKey`  | yes      | API key with the `Mail Send` permission (`SG.…`).      |
| `sandbox` | —        | Validate without delivering — SendGrid's sandbox mode. |
