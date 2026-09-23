import { useEmitter } from '@novastarter/emitter';
import type { NotificationChannel } from '../channel.js';
import {
	type Notification,
	type NotificationRecipient,
	notificationSchema,
	type NotificationSendResult,
} from '../types.js';

/**
 * The filter a notification passes before a channel delivers it: a handler may rewrite it or return `null` to drop
 * it. The meta carries the channel.
 *
 * @defaultValue `notification.send`
 */
export const NOTIFICATION_SEND_FILTER = 'notification.send';

/**
 * The action emitted once a channel delivered a notification: `{ channel, payload: notification }`.
 *
 * @defaultValue `notification.sent`
 */
export const NOTIFICATION_SENT_EVENT = 'notification.sent';

/**
 * The action emitted when a channel failed to deliver: `{ channel, payload: notification, error }`; the error is
 * rethrown for the job to retry.
 *
 * @defaultValue `notification.failed`
 */
export const NOTIFICATION_FAILED_EVENT = 'notification.failed';

/**
 * What the application registers: how to find a user, how to write a notification, what the user wants, and the
 * channels to use.
 */
export interface NotificationsOptions {
	/** The channels, as ready instances: `mailChannel()`, `pushChannel({ onGone })`, one of the application's own. */
	channels: NotificationChannel<any>[];
	/** Where a user can be reached, from the application's tables; `null` for a user that no longer exists. */
	findRecipient: (userId: string) => Promise<NotificationRecipient | null>;
	/**
	 * The content of a notification for a channel, from the application's templates: `MailContent` for `mail`,
	 * `SmsContent` for `sms`, `PushContent` for `push`, `MessengerContent` for a messenger, `InAppContent` for
	 * `in-app`. `null` when the type has nothing to say on the channel.
	 */
	render: (notification: Notification, channel: string, recipient: NotificationRecipient) => Promise<unknown>;
	/**
	 * Whether the user wants notifications of a type on a channel, from the application's preferences; every
	 * notification on every channel unless given.
	 */
	isEnabled?: ((userId: string, type: string, channel: string) => Promise<boolean>) | undefined;
}

/**
 * The notifications of the process: which channels a notification goes to, and the delivery on one of them.
 *
 * Delivery is one channel at a time, so the application queues a job per channel and a retry repeats only the channel
 * that failed: `plan()` where the event happens, a job per channel it answers, `send()` in the job. The recipient and
 * the preferences are read again at delivery, so a user who turned a channel off since is not told on it.
 *
 * @example
 * ```ts
 * for (const channel of await useNotifications().plan(notification)) {
 * 	await enqueue('notification.send', { notification, channel });
 * }
 *
 * // the job's handler
 * await useNotifications().send(payload.notification, { channel: payload.channel });
 * ```
 */
export class Notifications {
	/**
	 * The channels by name.
	 *
	 * @internal
	 */
	private readonly channels: Map<string, NotificationChannel<any>>;

	/**
	 * Create the notifications from the application's options.
	 *
	 * @param options - The channels and the application's callbacks.
	 * @throws Error when two channels share a name: which one delivers would depend on the order.
	 */
	constructor(private readonly options: NotificationsOptions) {
		this.channels = new Map();

		for (const channel of options.channels) {
			// 1. A duplicate name is a configuration mistake, caught at start-up
			if (this.channels.has(channel.name)) {
				throw new Error(`Notification channel "${channel.name}" is registered twice`);
			}

			this.channels.set(channel.name, channel);
		}
	}

	/**
	 * The names of the registered channels, in registration order.
	 *
	 * @returns The names.
	 */
	channelNames(): string[] {
		return [...this.channels.keys()];
	}

	/**
	 * The channels a notification goes to: the ones it asks for — every registered one when it asks for none — that
	 * reach the user and that the user wants.
	 *
	 * @param notification - The notification.
	 * @returns The channel names, in registration order; none for a user that no longer exists.
	 * @throws ZodError for a notification that is not one.
	 * @throws Error when the notification names a channel nobody registered.
	 */
	async plan(notification: Notification): Promise<string[]> {
		// 1. Checked here, where the application creates it, so a broken notification never reaches the queue
		const valid = notificationSchema.parse(notification);
		const wanted = valid.channels ?? this.channelNames();

		for (const name of wanted) {
			this.channel(name);
		}

		// 2. The user's addresses and preferences, once for all channels
		const recipient = await this.options.findRecipient(valid.userId);

		if (!recipient) {
			return [];
		}

		const planned: string[] = [];

		for (const name of this.channelNames().filter((candidate) => wanted.includes(candidate))) {
			if (this.channel(name).reaches(recipient) && (await this.isEnabled(valid, name))) {
				planned.push(name);
			}
		}

		return planned;
	}

	/**
	 * Deliver a notification on one channel.
	 *
	 * The notification passes the `notification.send` filter, then the recipient, the channel's reach, the user's
	 * preference and the rendered content are checked again; any of them missing skips the channel rather than failing,
	 * so the job does not retry what cannot succeed. `notification.sent` or `notification.failed` is emitted.
	 *
	 * @param notification - The notification.
	 * @param options - The channel to deliver on.
	 * @returns `sent`, or `skipped` with the reason.
	 * @throws ZodError for a notification that is not one.
	 * @throws Error when the channel is not registered.
	 * @throws What the channel throws when it fails, for the job to retry.
	 */
	async send(notification: Notification, options: { channel: string }): Promise<NotificationSendResult> {
		// 1. The notification and the channel, so a broken job fails for good rather than retrying
		const valid = notificationSchema.parse(notification);
		const channel = this.channel(options.channel);

		// 2. The application's last word: a handler may rewrite the notification or drop it
		const filtered = await useEmitter().emitFilter<Notification | null>(NOTIFICATION_SEND_FILTER, valid, {
			channel: channel.name,
		});

		if (!filtered) {
			return { status: 'skipped', reason: 'filter' };
		}

		// 3. Read at delivery, not at planning: the user may be gone, or have changed their mind, since
		const recipient = await this.options.findRecipient(filtered.userId);

		if (!recipient) {
			return { status: 'skipped', reason: 'recipient' };
		}

		if (!channel.reaches(recipient)) {
			return { status: 'skipped', reason: 'unreachable' };
		}

		if (!(await this.isEnabled(filtered, channel.name))) {
			return { status: 'skipped', reason: 'preference' };
		}

		// 4. The text of the day, in the user's language
		const content = await this.options.render(filtered, channel.name, recipient);

		if (content === null || content === undefined) {
			return { status: 'skipped', reason: 'content' };
		}

		// 5. The delivery; a failure is announced and rethrown as the channel made it
		try {
			await channel.send({ notification: filtered, recipient, content });
		} catch (error) {
			useEmitter().emitAction(NOTIFICATION_FAILED_EVENT, { channel: channel.name, payload: filtered, error });

			throw error;
		}

		useEmitter().emitAction(NOTIFICATION_SENT_EVENT, { channel: channel.name, payload: filtered });

		return { status: 'sent' };
	}

	/**
	 * A registered channel.
	 *
	 * @param name - Its name.
	 * @returns The channel.
	 * @throws Error when nobody registered it.
	 * @internal
	 */
	private channel(name: string): NotificationChannel<any> {
		// 1. A name nobody registered is a mistake in the code that made the notification, not something to skip
		const channel = this.channels.get(name);

		if (!channel) {
			throw new Error(`Notification channel "${name}" isn't registered`);
		}

		return channel;
	}

	/**
	 * Whether the user wants a notification's type on a channel.
	 *
	 * @param notification - The notification.
	 * @param channel - The channel's name.
	 * @returns The application's answer; `true` without preferences.
	 * @internal
	 */
	private async isEnabled(notification: Notification, channel: string): Promise<boolean> {
		// 1. No preferences registered means everything is on
		return this.options.isEnabled ? this.options.isEnabled(notification.userId, notification.type, channel) : true;
	}
}
