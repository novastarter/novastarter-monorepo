# `@novastarter/messenger-driver-telegram`

Telegram Bot API driver for `@novastarter/messenger`, over `fetch`, without an SDK.

## Installation

```
pnpm add @novastarter/messenger @novastarter/messenger-driver-telegram
```

## Usage

Register the class once at start-up, then a location per bot:

```ts
import { useMessenger } from '@novastarter/messenger';
import { MessengerDriverTelegram } from '@novastarter/messenger-driver-telegram';

useMessenger().registerDriver('telegram', MessengerDriverTelegram);
useMessenger().registerLocation('telegram', {
	driver: 'telegram',
	options: { token: env.TELEGRAM_BOT_TOKEN },
});
```

`sendMessage()` of `@novastarter/messenger` then turns a message into one Bot API call:

| Message       | Method           | Text          |
| ------------- | ---------------- | ------------- |
| text only     | `sendMessage`    | `text`        |
| one photo     | `sendPhoto`      | `caption`     |
| one document  | `sendDocument`   | `caption`     |
| several files | `sendMediaGroup` | first caption |

`format: 'markdown'` is Telegram's `MarkdownV2`, `html` its `HTML`; escape the values put into Markdown with
`escapeMarkdownV2()`. A file given as a URL or a Telegram file id goes as is; a `Blob` or `File` is uploaded as
multipart. `raw` is added to the call last, so it sets any parameter the message has no field for:

```ts
await sendMessage({ to: chatId, text: 'Hi', raw: { message_effect_id: '5104841245755180586' } });
```

Nothing is checked against Telegram's limits: Telegram refuses what it cannot take, and its description is the error's
message.

## Any other method

The Bot API is one `POST /bot<token>/<method>` for every method, so `call()` reaches all of them — one this package does
not know yet included — with the location's token, timeout and errors. A `Blob` or `File` among the parameters sends the
call as multipart.

```ts
const telegram = useMessenger().location('telegram') as MessengerDriverTelegram;

await telegram.call('setMessageReaction', {
	chat_id: chatId,
	message_id: 7,
	reaction: [{ type: 'emoji', emoji: '👍' }],
});
await telegram.call('sendPhoto', { chat_id: chatId, photo: new File([png], 'chart.png'), caption: 'Today' });
```

## Without registration

For a script, a deploy hook or an alert to the team's chat, `sendTelegram()` sends one message with a driver made for
the call — no manager, no events:

```ts
import { sendTelegram } from '@novastarter/messenger-driver-telegram';

await sendTelegram({ token: env.ALERTS_BOT_TOKEN, chatId: '-1001234567890', text: 'Deploy finished' });
```

## Errors

- `MessengerTargetGoneError` (410): the bot was blocked or kicked, the chat is gone — forget the chat id.
- `HitRateLimitError` (429): Telegram asked to slow down; `reset` is when to try again.
- `TimeoutError`: the call took longer than `timeout`.
- `Error`: any other refusal, with Telegram's description; the token is never in a message.

## Options

| Option          | Required | Description                                                       |
| --------------- | -------- | ----------------------------------------------------------------- |
| `token`         | yes      | The bot's token, from @BotFather.                                 |
| `apiUrl`        | —        | The Bot API server; `https://api.telegram.org` unless given.      |
| `timeout`       | —        | Milliseconds a call may take; 30 seconds unless given.            |
| `defaultFormat` | —        | The format of a message that names none; plain text unless given. |
