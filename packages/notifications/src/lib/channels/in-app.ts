import { randomUUID } from 'node:crypto';
import { useBus } from '@novastarter/memory';
import type { NotificationChannel, NotificationDelivery } from '../../channel.js';
import type { InAppContent, InAppRecord } from '../../types.js';

/**
 * The prefix of the bus channel an in-app notification is announced on; the user's id follows it.
 *
 * @defaultValue `notifications:`
 */
export const IN_APP_BUS_PREFIX = 'notifications:';

/**
 * Options of {@link inAppChannel}.
 */
export interface InAppChannelOptions {
	/** Store the notification in the application's inbox table. */
	save: (record: InAppRecord) => Promise<void>;
	/**
	 * The bus location to announce it on, so an open page shows it at once; `default` unless given, `false` for none.
	 * The channel is `notifications:<userId>`; a server-sent events route subscribes to it for the signed-in user.
	 */
	bus?: string | false | undefined;
}

/**
 * The in-app channel: the notification saved to the application's inbox and announced on the bus.
 *
 * Every user is reachable: the inbox needs no address. The record gets a fresh id, so a retried job saves it again —
 * the application's `save` ignores a record it already has when that matters.
 *
 * @param options - Where to save, and the bus location.
 * @returns The channel, named `in-app`.
 * @example
 * ```ts
 * registerNotifications({
 * 	channels: [inAppChannel({ save: (record) => db.insert(notifications).values(record) })],
 * 	findRecipient,
 * 	render,
 * });
 *
 * // a server-sent events route
 * await useBus().location().subscribe(`notifications:${session.userId}`, (record) => stream.write(record));
 * ```
 */
export const inAppChannel = (options: InAppChannelOptions): NotificationChannel<InAppContent> => ({
	name: 'in-app',

	/**
	 * Every user has an inbox.
	 *
	 * @returns `true`.
	 */
	reaches(): boolean {
		return true;
	},

	/**
	 * Save the notification, then announce it.
	 *
	 * @param delivery - The notification and the rendered content.
	 * @returns Once saved and announced.
	 * @throws What `save` or the bus throws.
	 */
	async send({ notification, content }: NotificationDelivery<InAppContent>): Promise<void> {
		// 1. The record: the rendered text plus what a client needs to render its own way
		const record: InAppRecord = {
			...content,
			id: randomUUID(),
			userId: notification.userId,
			type: notification.type,
			...(notification.data ? { data: notification.data } : {}),
			createdAt: Date.now(),
		};

		// 2. Saved first: the inbox is the truth, the announcement only spares an open page a reload
		await options.save(record);

		if (options.bus !== false) {
			await useBus()
				.location(options.bus ?? 'default')
				.publish(`${IN_APP_BUS_PREFIX}${notification.userId}`, record);
		}
	},
});
