# `@novastarter/mail-driver-mailtrap`

Mailtrap driver for `@novastarter/mail`.

## Installation

```
pnpm add @novastarter/mail @novastarter/mail-driver-mailtrap
```

## Usage

Register the class once at start-up, then a location per token with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useMail } from '@novastarter/mail';
import { MailDriverMailtrap } from '@novastarter/mail-driver-mailtrap';
import { env } from './env';

const mail = useMail();

mail.registerDriver('mailtrap', MailDriverMailtrap);

mail.registerLocation('main', {
	driver: 'mailtrap',
	options: {
		token: env.MAIL_MAILTRAP_TOKEN,
		sandbox: true,
		testInboxId: env.MAIL_MAILTRAP_INBOX_ID,
	},
});
```

Anywhere later: `sendMail(message)` routes through the location, or `useMail().location('main').send(message)` skips the
routes.

Through the official `mailtrap` SDK: the Email Sending API in production, the Email Sandbox for testing. The category is
Mailtrap's own `category`; the tags become a `tags` custom variable. `verify()` lists the accounts of the token and
requires at least one.

## Options

| Option        | Required | Description                                                                                      |
| ------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `token`       | yes      | API token from the Mailtrap dashboard.                                                           |
| `sandbox`     | —        | Deliver into the Email Sandbox (a test inbox) rather than to real recipients.                    |
| `testInboxId` | —        | Inbox the sandbox delivers into; required with `sandbox`.                                        |
| `bulk`        | —        | Send through Mailtrap's bulk stream (marketing infrastructure) instead of the transactional one. |
