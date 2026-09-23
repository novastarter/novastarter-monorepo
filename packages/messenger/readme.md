# `@novastarter/messenger`

Messenger messages for Novastarter: a driver contract, a manager of bot locations and `sendMessage()`, with text,
formatting and attachments.

## Installation

```
pnpm add @novastarter/messenger @novastarter/messenger-driver-telegram
```

One driver package per messenger: `messenger-driver-telegram`. The built-in `console` driver writes to the log, for
development.

## Usage

At start-up, once — a driver per messenger, a location per bot; `env` is the app's typed configuration.

```ts
import { useMessenger } from '@novastarter/messenger';
import { MessengerDriverTelegram } from '@novastarter/messenger-driver-telegram';

const messenger = useMessenger();

messenger.registerDriver('telegram', MessengerDriverTelegram);
messenger.registerLocation('telegram', {
	driver: 'telegram',
	options: { token: env.TELEGRAM_BOT_TOKEN },
});
```

Anywhere later:

```ts
import { sendMessage } from '@novastarter/messenger';

await sendMessage(
	{
		to: chatId,
		text: '*Invoice 1042* is paid',
		format: 'markdown',
		attachments: [{ kind: 'document', source: pdf, filename: 'invoice-1042.pdf' }],
	},
	{ location: 'telegram' },
);
```

A message goes through the call's `location`, else its own, else `default`. There is no fallback to another location: a
chat id belongs to one bot. The chat ids are the application's to store — the package only sends.

## The message

| Field         | Description                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `to`          | The recipient in the messenger's terms: a Telegram chat id.                                       |
| `text`        | The text; the caption when attachments go with it.                                                |
| `format`      | `text`, `markdown` or `html`; each driver maps it to its messenger's flavour.                     |
| `attachments` | `{ kind: 'photo' \| 'document', source, filename? }[]`; `source` is a URL, a file id or a `Blob`. |
| `silent`      | Deliver without a sound, where the messenger can.                                                 |
| `raw`         | What only one messenger understands, added to the driver's request as is.                         |

A message needs a recipient and text or an attachment; the messenger's own limits — text length, file size — are not
checked here, the messenger refuses what it cannot take and its reason travels as the error's `cause`.

## Any other request

`send()` covers what messengers share. The rest of a messenger's API — a reaction, an edit, a method the driver has no
wrapper for yet — is `call(method, params, options)`, optional on every driver, with the location's credentials, timeout
and errors; `options` takes a `timeout`, a `signal` and extra `headers`. The signature is the same for all; what
`method` means is the messenger's:

```ts
const messenger = useMessenger();

const { data } = await messenger.location('telegram').call!('sendPhoto', { chat_id: chatId, photo: file }); // an RPC method
await messenger.location('discord').call!('POST /channels/{id}/messages', { id: '123', content: 'Hi' }); // a REST verb and path
```

A `Blob` or `File` among the parameters is uploaded where the API takes files. Every `call()` answers
`{ status, headers, data }`; a `{name}` in a path is filled from the parameter of that name, and headers and a timeout
for every call of a location go in its registration's `call`. The `console` driver logs the call and answers a plain
`200` with no data.

## Events and errors

- `messenger.send` (filter): a handler may rewrite the message or return `null` to drop it.
- `messenger.sent`: `{ location, to, messageId }`.
- `messenger.gone`: `{ location, to, reason }` — the recipient blocked the bot or left the chat; `sendMessage()` throws
  `MessengerTargetGoneError` (410): forget the chat, do not retry.
- `messenger.failed`: `{ location, to }` — `sendMessage()` throws an `Error` with the driver's error as `cause`.

## Writing a driver

A driver implements `send(message)` of `MessengerDriver` (optionally `call()`, `verify()` and `close()`) and adds itself
to the driver map:

```ts
declare module '@novastarter/messenger' {
	interface MessengerDrivers {
		slack: MessengerDriverSlackConfig;
	}
}
```
