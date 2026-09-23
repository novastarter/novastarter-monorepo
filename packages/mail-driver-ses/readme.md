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
show up in the sending events. SES takes only ASCII letters, digits, `_` and `-` in a tag, at most 256 of them, so every
tag is sanitised on the way (`welcome flow` becomes `welcome_flow`), and one left with no name or with a name already
taken (`welcome flow` next to `welcome_flow`, or `category`) is dropped, rather than failing the whole send.

## Options

| Option                           | Required | Description                                                            |
| -------------------------------- | -------- | ---------------------------------------------------------------------- |
| `region`                         | —        | AWS region, e.g. `eu-west-1`; the SDK's default chain unless given.    |
| `accessKeyId`, `secretAccessKey` | —        | Access key pair; set together, or neither for the SDK's default chain. |
| `sessionToken`                   | —        | Session token of temporary credentials.                                |
| `endpoint`                       | —        | Custom endpoint, for LocalStack and the like.                          |
| `configurationSet`               | —        | SES configuration set every message is sent with.                      |

## Any other request

`call()` runs any SESv2 API action on the location's client, region and credentials — the way to the account,
identities, suppressions, templates and anything else the driver has no wrapper for. SES is an RPC-style API, so the
method is the action's name (with or without the SDK's `Command` suffix) and the parameters are its input.

```ts
const mail = useMail().location('main');

const { data: account } = await mail.call!('GetAccount');

const { status, data } = await mail.call!('ListSuppressedDestinations', { Reasons: ['BOUNCE'], PageSize: 100 });
```

It answers `{ status, headers, data }`: the HTTP status, no headers — the SDK's output does not keep them — and the
action's output without the SDK's `$metadata`. There are no URLs, so no host list: every request goes to the SES
endpoint of the location's region (or its `endpoint`). A name that is not an SESv2 action is refused before anything is
sent; a refusal of SES throws `ProviderCallError` with its HTTP status and `{ name, message }`, a 429 or
`TooManyRequestsException` `HitRateLimitError`; the timeout is 30 seconds unless `{ timeout }` names another, and it
applies to each HTTP attempt as well as to the whole call. The SDK signs its own requests and sends no extra header: a
`headers` option — the call's or the location's — is refused with an error rather than dropped.

## The SDK client

`call()` covers plain actions only. For the rest of the SESv2 API — paginators, waiters, middleware — the driver's
`client` is the SDK's own `SESv2Client`, on the location's region and credentials:

```ts
import { paginateListSuppressedDestinations } from '@aws-sdk/client-sesv2';
import type { MailDriverSes } from '@novastarter/mail-driver-ses';

const ses = useMail().location('main') as MailDriverSes;

for await (const page of paginateListSuppressedDestinations({ client: ses.client }, { Reasons: ['BOUNCE'] })) {
	console.log(page.SuppressedDestinationSummaries);
}
```
