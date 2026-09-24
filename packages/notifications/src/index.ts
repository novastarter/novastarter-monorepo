/**
 * Public entry point of `@novastarter/notifications`.
 *
 * One notification to a user over several channels: the {@link NotificationChannel} contract with the built-in
 * {@link mailChannel}, {@link smsChannel}, {@link pushChannel}, {@link messengerChannel} and {@link inAppChannel},
 * the process-wide {@link Notifications} set up by {@link registerNotifications} and handed out by
 * {@link useNotifications}, and the {@link Notification} the application queues, with its {@link notificationSchema}.
 * Templates, preferences, addresses and the queue job are the application's.
 */
export type { NotificationChannel, NotificationDelivery } from './channel.js';
export {
	IN_APP_BUS_PREFIX,
	inAppChannel,
	mailChannel,
	messengerChannel,
	pushChannel,
	smsChannel,
	type InAppChannelOptions,
	type MailChannelOptions,
	type MessengerChannelOptions,
	type PushChannelOptions,
	type SmsChannelOptions,
} from './lib/channels/index.js';
export {
	NOTIFICATION_FAILED_EVENT,
	NOTIFICATION_SEND_FILTER,
	NOTIFICATION_SENT_EVENT,
	Notifications,
	type NotificationsOptions,
} from './lib/notifications.js';
export { registerNotifications, useNotifications } from './lib/use-notifications.js';
export {
	notificationSchema,
	type InAppContent,
	type InAppRecord,
	type MailContent,
	type MessengerContent,
	type Notification,
	type NotificationRecipient,
	type NotificationSendResult,
	type PushContent,
	type PushTarget,
	type SmsContent,
} from './types.js';
