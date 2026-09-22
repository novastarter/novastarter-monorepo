import { type PushMessage, toCollapseId } from '@novastarter/push';
import { Notification, type NotificationOptions, Priority } from 'apns2';
import type { PushDriverApnsConfig } from './driver.js';

/**
 * The APNs priority of a message's urgency: `high` wakes the device now, `normal` lets APNs batch, the low ones wait
 * for a power-friendly moment.
 *
 * @param urgency - The message's urgency.
 * @returns APNs's 10, 5 or 1.
 */
export const toApnsPriority = (urgency: PushMessage['urgency']): Priority => {
	// 1. Three levels on Apple's side for four on ours: both low ones wait for a power-friendly moment
	if (urgency === 'high') return Priority.immediate;
	if (urgency === 'low' || urgency === 'very-low') return Priority.low;

	return Priority.throttled;
};

/**
 * Translate a message into the APNs notification for its token.
 *
 * The title and body go under `aps.alert`; the click target, the image and the custom pairs are top-level keys of
 * the payload, for the app to read (`url`, `image`, then `data`); an image sets `mutable-content` so the app's
 * notification service extension can attach it. The tag is the collapse id, sanitized by {@link toCollapseId}, the
 * ttl the expiration.
 *
 * @param message - Ours, with a token.
 * @param config - The location's topic, ttl and sound.
 * @param now - The clock, for the expiration; the current time unless given.
 * @returns The notification.
 */
export const toApnsNotification = (
	message: PushMessage,
	config: Pick<PushDriverApnsConfig, 'topic' | 'ttl' | 'sound'>,
	now: Date = new Date(),
): Notification => {
	// 1. The message's own ttl wins over the location's; the custom pairs carry the click target and the image
	const ttl = message.ttl ?? config.ttl;
	const sound = config.sound ?? 'default';
	const collapseId = toCollapseId(message.tag);

	const data = {
		...(message.data ?? {}),
		...(message.url !== undefined ? { url: message.url } : {}),
		...(message.image !== undefined ? { image: message.image } : {}),
	};

	// 2. `apns-expiration` is an absolute Unix time; `0` means "deliver now or drop". The alert's body is required by
	//    the client's types; an empty one shows the title alone
	const options: NotificationOptions = {
		type: 'alert',
		topic: config.topic,
		alert: { title: message.title, body: message.body ?? '' },
		priority: toApnsPriority(message.urgency),
		...(ttl !== undefined ? { expiration: ttl > 0 ? Math.floor(now.getTime() / 1000) + ttl : 0 } : {}),
		...(collapseId !== undefined ? { collapseId } : {}),
		...(sound ? { sound } : {}),
		...(message.image !== undefined ? { mutableContent: true } : {}),
		...(Object.keys(data).length > 0 ? { data } : {}),
	};

	return new Notification(message.token as string, options);
};
