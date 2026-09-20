import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobContract } from '../types.js';

/**
 * The channels a notification reaches a user on.
 *
 * @defaultValue `inapp`, `email`, `sms`, `push`, `chat`
 */
export const NOTIFICATION_CHANNELS = ['inapp', 'email', 'sms', 'push', 'chat'] as const;

/**
 * A channel.
 */
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Who a notification is for, as `notify()` learned it: the user, and what the channels need that the user table
 * does not hold (a phone number lives in the app's own tables).
 */
export interface NotificationRecipient {
	/** The user (`user.id`). */
	userId: string;
	/** Overrides the user's email. */
	email?: string | undefined;
	/** Overrides the user's name. */
	name?: string | undefined;
	/** The phone for the `sms` channel, E.164. */
	phone?: string | undefined;
	/** Overrides the user's locale. */
	locale?: string | undefined;
}

/**
 * What a caller passes to `notifications.deliver`: one notification on one channel, as `notify()` enqueues it.
 */
export interface NotificationsDeliverInput {
	channel: NotificationChannel;
	/** The notification type (`invoice.paid`), registered with `defineNotification()`. */
	type: string;
	recipient: NotificationRecipient;
	/** The type's payload, as validated by its schema. */
	payload: Record<string, unknown>;
	/** When `notify()` was called; a `Date` in-process, an ISO string over Redis. */
	notifiedAt?: Date | string | undefined;
}

/**
 * What the `notifications.deliver` handler receives.
 */
export interface NotificationsDeliverPayload extends Omit<NotificationsDeliverInput, 'notifiedAt'> {
	notifiedAt: Date;
}

/**
 * Schema of a {@link NotificationRecipient}.
 */
export const notificationRecipientSchema: z.ZodType<NotificationRecipient, NotificationRecipient> = z.object({
	userId: z.string().min(1),
	email: z.email().optional(),
	name: z.string().min(1).optional(),
	phone: z.string().min(1).optional(),
	locale: z.string().min(2).optional(),
});

/**
 * Schema of a `notifications.deliver` payload.
 */
export const notificationsDeliverSchema: z.ZodType<NotificationsDeliverPayload, NotificationsDeliverInput> = z.object({
	channel: z.enum(NOTIFICATION_CHANNELS),
	type: z.string().min(1),
	recipient: notificationRecipientSchema,
	payload: z.record(z.string(), z.unknown()),
	notifiedAt: z
		.union([z.date(), z.iso.datetime({ offset: true })])
		.default(() => new Date())
		.transform((value) => (value instanceof Date ? value : new Date(value))),
});

/**
 * `notifications.deliver` — one notification on one channel: the in-app row, a `mail.send`, an SMS, the user's
 * push devices, a chat post.
 *
 * Retried five times with growing waits, like mail: a provider that is down for a minute should not lose the
 * notification. A retry after a partial delivery (one push device of three) resends to the devices that failed only,
 * since the handler deletes gone ones and the rest are idempotent enough for a notification.
 */
export const notificationsDeliver: JobContract<'notifications.deliver', typeof notificationsDeliverSchema> = defineJob({
	name: 'notifications.deliver',
	schema: notificationsDeliverSchema,
	options: {
		attempts: 5,
		backoff: { type: 'exponential', delay: 5_000 },
	},
});

/**
 * Payload of `notifications.digest`: every user with unread notifications, or one.
 */
export interface NotificationsDigestPayload {
	/** Only this user's digest; everyone's unless given. */
	userId?: string | undefined;
}

/**
 * Schema of a {@link NotificationsDigestPayload}.
 */
export const notificationsDigestSchema: z.ZodType<NotificationsDigestPayload, NotificationsDigestPayload> = z.object({
	userId: z.string().min(1).optional(),
});

/**
 * `notifications.digest` — one email per user with the notifications they chose to receive as a digest, on the
 * `NOTIFICATIONS_DIGEST_CRON` schedule.
 *
 * One try: the next run picks up whatever this one left undigested. Unique, so a schedule firing while a run is
 * still going does not stack a second one.
 */
export const notificationsDigest: JobContract<'notifications.digest', typeof notificationsDigestSchema> = defineJob({
	name: 'notifications.digest',
	schema: notificationsDigestSchema,
	options: {
		attempts: 1,
		unique: true,
	},
});
