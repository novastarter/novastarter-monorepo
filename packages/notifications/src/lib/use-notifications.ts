import { type Singleton, singleton } from '@novastarter/utils';
import { Notifications, type NotificationsOptions } from './notifications.js';

/**
 * Return the process-wide {@link Notifications}, the ones given to {@link registerNotifications}.
 *
 * @returns The same object on every call; `useNotifications.reset()` drops it, for tests.
 * @throws Error before {@link registerNotifications} ran: a notification with nowhere to go would otherwise vanish
 * without a trace.
 * @example
 * ```ts
 * const channels = await useNotifications().plan({ type: 'invoice.paid', userId, data: { invoice: '1042' } });
 * ```
 */
export const useNotifications: Singleton<Notifications> = singleton(() => {
	// 1. Nothing to build from: the channels and the callbacks are the application's
	throw new Error('Notifications are not registered; call registerNotifications() at start-up.');
});

/**
 * Make a set of channels and callbacks the process-wide notifications.
 *
 * What the application calls at start-up, once. Registering again replaces them for every later `useNotifications()`
 * call.
 *
 * @param options - The channels, and how to find, render for and ask the user.
 * @throws Error when two channels share a name.
 * @example
 * ```ts
 * registerNotifications({
 * 	channels: [
 * 		mailChannel(),
 * 		smsChannel(),
 * 		pushChannel({ onGone: deletePushTarget }),
 * 		inAppChannel({ save: saveInbox }),
 * 	],
 * 	findRecipient: async (userId) => loadRecipient(userId),
 * 	render: async (notification, channel, recipient) => renderTemplate(notification.type, channel, recipient.locale),
 * 	isEnabled: async (userId, type, channel) => loadPreference(userId, type, channel),
 * });
 * ```
 */
export const registerNotifications = (options: NotificationsOptions): void => {
	// 1. Replace rather than merge: the registration is the whole configuration of the process
	useNotifications.replace(new Notifications(options));
};
