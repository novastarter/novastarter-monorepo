import type { MailMessage } from '@novastarter/mail';
import type { MessengerMessage } from '@novastarter/messenger';
import type { PushMessage } from '@novastarter/push';
import type { SmsMessage } from '@novastarter/sms';
import { z } from 'zod';

/**
 * Something that happened, for one user: what the application hands to the queue and to `send()`.
 *
 * The notification carries no text: the channels ask the application's `render` for their content when they deliver,
 * in the user's language and with the templates of the day.
 */
export interface Notification {
	/** What happened: `invoice.paid`, `comment.created`. Preferences and templates are keyed by it. */
	type: string;
	/** The user to tell. */
	userId: string;
	/**
	 * A stable id of the event, when the application has one: it survives the queue and the schema, so a retried job
	 * delivers the same id and an in-app inbox can upsert on it instead of duplicating the row. The in-app record's id is
	 * `<userId>:<id>`, so one event sent to several users with the same id still makes one row per user. Given none,
	 * the in-app channel gives the record a fresh one.
	 */
	id?: string | undefined;
	/** The channels to use; every registered one unless given. The user's preferences still apply. */
	channels?: string[] | undefined;
	/** What the templates need: the invoice number, the comment's author. Plain JSON, since it goes through a queue. */
	data?: Record<string, unknown> | undefined;
}

/**
 * A notification as the queue carries it and `send()` accepts it.
 */
export const notificationSchema: z.ZodType<Notification> = z.object({
	type: z.string().min(1),
	userId: z.string().min(1),
	id: z.string().min(1).optional(),
	channels: z.array(z.string().min(1)).optional(),
	data: z.record(z.string(), z.unknown()).optional(),
});

/**
 * A device the user gets pushes on, as the application stored it: a browser's subscription, or a mobile token.
 */
export type PushTarget = Pick<PushMessage, 'subscription' | 'token' | 'platform' | 'location'>;

/**
 * Where a user can be reached, as the application's `findRecipient` answers.
 *
 * A channel without its address is skipped for the user: no phone, no SMS.
 */
export interface NotificationRecipient {
	/** The user. */
	userId: string;
	/** The address mail goes to. */
	email?: string | null | undefined;
	/** The number SMS go to, in E.164. */
	phone?: string | null | undefined;
	/** Every device of the user; a push goes to each. */
	pushTargets?: PushTarget[] | undefined;
	/** The user's chat with each messenger location — `{ telegram: '123456789' }` — as the application linked them. */
	messengers?: Record<string, string> | undefined;
	/** The user's language, for the application's `render`. */
	locale?: string | undefined;
}

/**
 * The content of a mail notification: a message without its recipient, which the channel fills in.
 */
export type MailContent = Omit<MailMessage, 'to'>;

/**
 * The content of an SMS notification: a message without its recipient.
 */
export type SmsContent = Omit<SmsMessage, 'to'>;

/**
 * The content of a push notification: a message without its target.
 */
export type PushContent = Omit<PushMessage, 'subscription' | 'token' | 'platform' | 'location'>;

/**
 * The content of a messenger notification: a message without its chat and location, which the channel fills in.
 */
export type MessengerContent = Omit<MessengerMessage, 'to' | 'location'>;

/**
 * The content of an in-app notification: what the inbox shows.
 */
export interface InAppContent {
	/** The line the inbox shows. */
	title: string;
	/** More text under it. */
	body?: string | undefined;
	/** Where a click goes. */
	url?: string | undefined;
}

/**
 * An in-app notification as the application stores it and the bus announces it.
 */
export interface InAppRecord extends InAppContent {
	/**
	 * `<userId>:<id>` when the notification carried a {@link Notification.id} — the inbox's key, so the application's
	 * `save` upserts a retried job's delivery instead of inserting a duplicate, and each recipient of one event keeps
	 * its own row; a fresh one otherwise.
	 */
	id: string;
	/** The user it is for. */
	userId: string;
	/** What happened, from the notification. */
	type: string;
	/** The notification's data, for a client that renders its own way. */
	data?: Record<string, unknown> | undefined;
	/** When it was made, in milliseconds since the epoch. */
	createdAt: number;
}

/**
 * What {@link Notifications.send} answers with for one channel.
 */
export type NotificationSendResult =
	| { status: 'sent' }
	| {
			status: 'skipped';
			/**
			 * Why nothing was sent: `filter` — a `notification.send` handler dropped it; `recipient` — no such user;
			 * `unreachable` — no address for the channel; `preference` — the user turned it off; `content` — `render`
			 * had nothing for the channel.
			 */
			reason: 'filter' | 'recipient' | 'unreachable' | 'preference' | 'content';
	  };
