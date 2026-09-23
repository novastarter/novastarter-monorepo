# `@novastarter/notifications`

Notifications for Novastarter: one notification to a user over mail, SMS, push and an in-app inbox, with their
preferences.

## Installation

```
pnpm add @novastarter/notifications
```

The channels send through `@novastarter/mail`, `@novastarter/sms`, `@novastarter/push` and the bus of
`@novastarter/memory`; register the locations of those the application uses.

## Usage

At start-up, once — the channels as ready instances, and the application's callbacks. The package stores nothing and
knows no templates: addresses, preferences, the inbox table and the texts are the application's.

```ts
import { inAppChannel, mailChannel, pushChannel, registerNotifications, smsChannel } from '@novastarter/notifications';

registerNotifications({
	channels: [
		mailChannel(),
		smsChannel(),
		pushChannel({ onGone: async (target) => deletePushTarget(target) }),
		inAppChannel({ save: async (record) => saveInboxRecord(record) }),
	],
	// { userId, email, phone, pushTargets, locale } from the application's tables; null for a deleted user
	findRecipient: async (userId) => loadRecipient(userId),
	// the content of a type on a channel: MailContent, SmsContent, PushContent or InAppContent; null to skip it
	render: async (notification, channel, recipient) => renderNotification(notification, channel, recipient.locale),
	// the user's preferences; everything is on without it
	isEnabled: async (userId, type, channel) => loadPreference(userId, type, channel),
});
```

Delivery goes through the queue, one job per channel, so a retry repeats only the channel that failed. The job is the
application's, like every job:

```ts
// jobs/notification-send.ts
export const notificationSend = registerJob(
	defineJob({
		name: 'notification.send',
		schema: z.object({ notification: notificationSchema, channel: z.string() }),
		options: { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
	}),
);

registerJobHandlers({
	'notification.send': async ({ notification, channel }) => {
		await useNotifications().send(notification, { channel });
	},
});

// where something happens
const notification = { type: 'invoice.paid', userId, data: { invoice: '1042' } };

for (const channel of await useNotifications().plan(notification)) {
	await enqueue('notification.send', { notification, channel });
}
```

`plan()` answers the channels a notification goes to: the ones it asks for (`channels`, every registered one unless
given) that reach the user — no phone, no SMS — and that the user wants. `send()` delivers on one channel and answers
`{ status: 'sent' }`, or `{ status: 'skipped', reason }` when the user is gone, unreachable, has turned the channel off
since, or `render` has nothing for it — none of which the job should retry. A failing channel throws, and the job
retries.

## Channels

| Channel  | Factory                       | Sends                                                                          |
| -------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `mail`   | `mailChannel({ location })`   | `sendMail()` to `recipient.email`.                                             |
| `sms`    | `smsChannel({ location })`    | `sendSms()` to `recipient.phone`.                                              |
| `push`   | `pushChannel({ onGone })`     | `sendPush()` to every `recipient.pushTargets`; a gone device goes to `onGone`. |
| `in-app` | `inAppChannel({ save, bus })` | `save(record)`, then publishes it on the bus channel `notifications:<userId>`. |

The push channel tries every device before it throws, so a retry sends again to the devices that got it: give the push a
`tag`, and a repeat replaces the shown notification instead of stacking. The in-app record has a fresh id each time;
`save` ignores a duplicate when that matters. A page follows the inbox live by subscribing to the bus channel of the
signed-in user from a server-sent events route.

Another channel — Slack, a webhook — is an object with a `name`, `reaches(recipient)` and
`send({ notification, recipient, content })`, passed in `channels` like the others.

## Events

- `notification.send` (filter): a handler may rewrite the notification or return `null` to skip it; the meta carries the
  channel.
- `notification.sent`: `{ channel, payload: notification }`.
- `notification.failed`: `{ channel, payload: notification, error }`.
