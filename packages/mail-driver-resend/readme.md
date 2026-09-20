# `@novastarter/mail-driver-resend`

Resend driver for `@novastarter/mail`.

## Installation

```
pnpm add @novastarter/mail @novastarter/mail-driver-resend
```

## Usage

Register the class once at start-up, then a location per API key with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useMail } from '@novastarter/mail';
import { MailDriverResend } from '@novastarter/mail-driver-resend';
import { env } from './env';

const mail = useMail();

mail.registerDriver('resend', MailDriverResend);

mail.registerLocation('main', {
	driver: 'resend',
	options: {
		apiKey: env.MAIL_RESEND_API_KEY,
	},
});
```

Anywhere later: `sendMail(message)` routes through the location, or `useMail().location('main').send(message)` skips the
routes.

Through the official `resend` SDK; the category and the tags become Resend tags (`category=<category>`, `<tag>=1`),
which the dashboard filters by. The SDK reports a refusal as a value; the driver turns it into a throw naming the
provider, so `sendMail()` falls back.

## Options

| Option   | Required | Description                                 |
| -------- | -------- | ------------------------------------------- |
| `apiKey` | yes      | API key from the Resend dashboard (`re_…`). |
