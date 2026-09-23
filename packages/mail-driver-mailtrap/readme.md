# `@novastarter/mail-driver-mailtrap`

Mailtrap mail driver for `@novastarter/mail`.

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

## Any other request

`call()` makes a request of Mailtrap's own API with the location's token — the way to sending domains, contacts,
suppressions, sandbox inboxes and anything else the driver has no wrapper for. The method is the verb and a path from
`https://mailtrap.io`; the parameters are the query of a `GET`, `HEAD` or `DELETE` and the JSON body otherwise. It
answers `{ status, headers, data }`.

```ts
const mail = useMail().location('main');

const { data: accounts } = await mail.call!<{ id: number; name: string }[]>('GET /api/accounts');
```

A `{name}` in the path takes the parameter of that name, URL-encoded, and that parameter is not sent again:

```ts
const { status, data } = await mail.call!('GET /api/accounts/{accountId}/sending_domains', { accountId: 1 });
```

A full URL may point at `mailtrap.io`, `send.api.mailtrap.io`, `bulk.api.mailtrap.io` or `sandbox.api.mailtrap.io`; any
other host is refused before the request, so the token never leaves Mailtrap. An error status throws `ProviderCallError`
with Mailtrap's status and answer, a 429 `HitRateLimitError`; the timeout is 30 seconds unless `{ timeout }` names
another.
