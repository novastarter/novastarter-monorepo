import { InvalidPayloadError } from '@novastarter/errors';
import { type PushMessage, toCollapseId } from '@novastarter/push';
import { Notification, type NotificationOptions, Priority } from 'apns2';
import type { PushDriverApnsConfig } from './driver.js';

/**
 * The APNs priority of a message's urgency: `high` wakes the device now, everything else lets APNs pick a
 * power-friendly moment.
 *
 * APNs accepts priority `1` for `background` pushes only and refuses an `alert` push at `1` with `400 BadPriority`, so
 * both low urgencies take `5` — the lowest an alert push may use — instead of the `1` their name suggests.
 *
 * @param urgency - The message's urgency.
 * @returns APNs's 10 or 5.
 */
export const toApnsPriority = (urgency: PushMessage['urgency']): Priority => {
	// An alert push may only be sent at 10 or 5: priority 1 is legal for `background` pushes alone, so both low urgencies
	// take 5, the power-friendly moment, exactly like `normal`
	if (urgency === 'high') return Priority.immediate;

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
 * @throws InvalidPayloadError when the message carries no token — a subscription belongs to the webpush driver.
 */
export const toApnsNotification = (
	message: PushMessage,
	config: Pick<PushDriverApnsConfig, 'topic' | 'ttl' | 'sound'>,
	now: Date = new Date(),
): Notification => {
	// `send()` guards, but a direct caller may not
	if (!message.token) {
		throw new InvalidPayloadError({
			reason: 'The apns push driver needs a token; a subscription belongs to the webpush driver',
		});
	}

	// The custom pairs carry the click target and the image
	const ttl = message.ttl ?? config.ttl;
	const sound = config.sound ?? 'default';
	const collapseId = toCollapseId(message.tag);

	const data = {
		...(message.data ?? {}),
		...(message.url !== undefined ? { url: message.url } : {}),
		...(message.image !== undefined ? { image: message.image } : {}),
	};

	// `apns-expiration` is an absolute Unix time; `0` means "deliver now or drop". The alert's body is required by the
	// client's types; an empty one shows the title alone
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

	return new Notification(message.token, options);
};
