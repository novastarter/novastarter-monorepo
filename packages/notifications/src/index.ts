/**
 * Public entry point of `@novastarter/notifications`.
 *
 * One notification to a user over several channels: the {@link NotificationChannel} contract with the built-in
 * {@link mailChannel}, {@link smsChannel}, {@link pushChannel}, {@link messengerChannel} and {@link inAppChannel},
 * the process-wide {@link Notifications} set up by {@link registerNotifications} and handed out by
 * {@link useNotifications}, and the {@link Notification} the application queues, with its {@link notificationSchema}.
 * Templates, preferences, addresses and the queue job are the application's.
 */
export * from './channel.js';
export * from './lib/channels/index.js';
export * from './lib/notifications.js';
export * from './lib/use-notifications.js';
export * from './types.js';
