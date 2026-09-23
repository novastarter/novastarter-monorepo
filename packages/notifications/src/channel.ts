import type { Notification, NotificationRecipient } from './types.js';

/**
 * What a channel gets to deliver one notification.
 *
 * @typeParam Content - The content the channel's `render` answer is, `MailContent` for the mail channel.
 */
export interface NotificationDelivery<Content = unknown> {
	/** The notification. */
	notification: Notification;
	/** Where the user can be reached. */
	recipient: NotificationRecipient;
	/** What the application's `render` made for this channel. */
	content: Content;
}

/**
 * Contract every way of telling a user implements: the built-in mail, SMS, push and in-app channels, or one of the
 * application's own — a Slack message, a webhook.
 *
 * A channel is a ready instance handed to `registerNotifications({ channels })`; it knows how to reach a recipient and
 * how to send, nothing about templates or preferences, which the notifications service handles the same way for all.
 *
 * @typeParam Content - The content the channel sends.
 */
export interface NotificationChannel<Content = unknown> {
	/** The channel's name — `mail`, `sms`, `push`, `in-app` — as notifications, preferences and `render` name it. */
	readonly name: string;

	/**
	 * Whether the recipient has an address on this channel.
	 *
	 * @param recipient - Where the user can be reached.
	 * @returns `false` to skip the channel for the user.
	 */
	reaches(recipient: NotificationRecipient): boolean;

	/**
	 * Deliver one notification.
	 *
	 * @param delivery - The notification, the recipient and the rendered content.
	 * @returns Once delivered.
	 * @throws What the transport throws; the job running the delivery retries it.
	 */
	send(delivery: NotificationDelivery<Content>): Promise<void>;
}
