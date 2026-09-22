import { type PushMessage, toCollapseId } from '@novastarter/push';
import type { TokenMessage } from 'firebase-admin/messaging';
import type { PushDriverFcmConfig } from './driver.js';

/**
 * Translate a message into FCM's `Message` for a token, with the platform blocks that carry what the common
 * `notification` cannot.
 *
 * `data` goes out as given, with the click target under `url` for native clients; the web block gets the icon,
 * badge, image and tag and — for an `https:` target only, since FCM refuses anything else — the link. The image
 * reaches the common block and the APNs block only as an absolute `http(s):` URL, the one form FCM accepts there; a
 * relative one is delivered to the web block alone. A ttl of `0` is "now or never" on every platform; the tag is
 * sanitised by {@link toCollapseId} for the APNs collapse id, whose limit APNs enforces on what FCM relays.
 *
 * @param message - The message, with its `token`.
 * @param config - The location's TTL and analytics label.
 * @param now - The current time, for the APNs expiration header.
 * @returns FCM's message.
 * @throws Error when the message carries no token — a subscription belongs to the webpush driver.
 */
export const toFcmMessage = (
	message: PushMessage,
	config: Pick<PushDriverFcmConfig, 'ttl' | 'analyticsLabel'> = {},
	now: Date = new Date(),
): TokenMessage => {
	// 1. A subscription cannot be delivered here; `send()` guards, but a direct caller may not
	if (!message.token) {
		throw new Error('The fcm push driver needs a token; a subscription belongs to the webpush driver');
	}

	// 2. The message's own ttl wins over the location's; `high` is the one urgency FCM tells apart
	const ttl = message.ttl ?? config.ttl;
	const high = message.urgency === 'high';
	const data = { ...(message.data ?? {}), ...(message.url !== undefined ? { url: message.url } : {}) };
	const collapseId = toCollapseId(message.tag);

	// 3. FCM checks the image of the common block and of the APNs block as an absolute http(s) URL and refuses the
	//    whole message otherwise; a relative one, fine for the web, is kept out of those two
	const image = message.image !== undefined && /^https?:\/\//.test(message.image) ? message.image : undefined;

	// 4. `apns-expiration` is an absolute Unix time; a ttl of 0 must become `0`, "deliver now or drop", since a
	//    timestamp of the send time is already past when APNs reads it and the message is discarded unattempted
	let expiration: string | undefined;

	if (ttl !== undefined) {
		expiration = ttl > 0 ? String(Math.floor(now.getTime() / 1000) + ttl) : '0';
	}

	// 5. The common block carries the text; each platform block what only it understands
	return {
		token: message.token,
		notification: {
			title: message.title,
			...(message.body !== undefined ? { body: message.body } : {}),
			...(image !== undefined ? { imageUrl: image } : {}),
		},
		...(Object.keys(data).length > 0 ? { data } : {}),
		android: {
			priority: high ? 'high' : 'normal',
			...(ttl !== undefined ? { ttl: ttl * 1000 } : {}),
			...(message.tag !== undefined ? { collapseKey: message.tag, notification: { tag: message.tag } } : {}),
		},
		apns: {
			headers: {
				'apns-priority': high ? '10' : '5',
				...(expiration !== undefined ? { 'apns-expiration': expiration } : {}),
				...(collapseId !== undefined ? { 'apns-collapse-id': collapseId } : {}),
			},
			// 6. An image needs the app's notification service extension to run: `mutable-content`
			payload: { aps: { sound: 'default', ...(image !== undefined ? { 'mutable-content': 1 } : {}) } },
			...(image !== undefined ? { fcmOptions: { imageUrl: image } } : {}),
		},
		webpush: {
			headers: {
				Urgency: message.urgency ?? 'normal',
				...(ttl !== undefined ? { TTL: String(ttl) } : {}),
			},
			notification: {
				...(message.icon !== undefined ? { icon: message.icon } : {}),
				...(message.badge !== undefined ? { badge: message.badge } : {}),
				...(message.image !== undefined ? { image: message.image } : {}),
				...(message.tag !== undefined ? { tag: message.tag } : {}),
				data,
			},
			...(message.url?.startsWith('https://') ? { fcmOptions: { link: message.url } } : {}),
		},
		...(config.analyticsLabel !== undefined ? { fcmOptions: { analyticsLabel: config.analyticsLabel } } : {}),
	};
};
