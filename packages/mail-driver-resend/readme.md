# `@novastarter/mail-driver-resend`

Resend mail driver for `@novastarter/mail`.

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
which the dashboard filters by. Attachments go base64-encoded — text content is encoded and a local `path` is read by
the driver, since Resend only fetches URLs — inline when they carry a content id. The SDK reports a refusal as a value;
the driver turns it into a throw naming the provider with that value as the `cause`, so `sendMail()` falls back and the
caller can still read Resend's status code.

## Any other request

`call()` makes a request of the [Resend API](https://resend.com/docs/api-reference/introduction) with the location's key
— the parameters of a `GET`, `HEAD` or `DELETE` go in the query, the rest as JSON. It answers
`{ status, headers, data }`. A refusal throws `ProviderCallError` (`HitRateLimitError` on a 429); the default timeout is
30 s.

```ts
const mail = useMail().location('main');

const { data: domains } = await mail.call!('GET /domains');
```

A `{name}` in the path takes the parameter of that name, URL-encoded, and that parameter is not sent again. The headers
carry Resend's rate limit:

```ts
const { data, headers } = await mail.call!('GET /domains/{id}', { id: 'd91cd9bd-1176-453e-8fc1-35364d380206' });

console.log(headers['ratelimit-remaining'], data);
```

A path is joined to `https://api.resend.com`; a full URL may only point at `api.resend.com`.

## Options

| Option   | Required | Description                                 |
| -------- | -------- | ------------------------------------------- |
| `apiKey` | yes      | API key from the Resend dashboard (`re_…`). |
