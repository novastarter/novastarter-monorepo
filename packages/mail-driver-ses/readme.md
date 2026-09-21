# `@novastarter/mail-driver-ses`

Amazon SES mail driver for `@novastarter/mail`.

## Installation

```
pnpm add @novastarter/mail @novastarter/mail-driver-ses
```

## Usage

Register the class once at start-up, then a location per account with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme. Credentials
are optional: without them the AWS SDK's default chain (environment, profile, instance role) applies.

```ts
import { useMail } from '@novastarter/mail';
import { MailDriverSes } from '@novastarter/mail-driver-ses';
import { env } from './env';

const mail = useMail();

mail.registerDriver('ses', MailDriverSes);

mail.registerLocation('main', {
	driver: 'ses',
	options: {
		region: env.MAIL_SES_REGION,
		accessKeyId: env.MAIL_SES_ACCESS_KEY_ID,
		secretAccessKey: env.MAIL_SES_SECRET_ACCESS_KEY,
	},
});
```

Anywhere later: `sendMail(message)` routes through the location, or `useMail().location('main').send(message)` skips the
routes.

Through nodemailer's SES transport on `@aws-sdk/client-sesv2`; the category and the tags become SES message tags, which
show up in the sending events.

## Options

| Option                           | Required | Description                                                            |
| -------------------------------- | -------- | ---------------------------------------------------------------------- |
| `region`                         | —        | AWS region, e.g. `eu-west-1`; the SDK's default chain unless given.    |
| `accessKeyId`, `secretAccessKey` | —        | Access key pair; set together, or neither for the SDK's default chain. |
| `sessionToken`                   | —        | Session token of temporary credentials.                                |
| `endpoint`                       | —        | Custom endpoint, for LocalStack and the like.                          |
| `configurationSet`               | —        | SES configuration set every message is sent with.                      |
