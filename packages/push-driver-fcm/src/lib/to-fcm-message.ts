import type { PushMessage } from '@novastarter/push';
import type { TokenMessage } from 'firebase-admin/messaging';
import { APNS_COLLAPSE_ID_MAX_LENGTH } from './constants.js';
import type { PushDriverFcmConfig } from './driver.js';

/**
 * Translate a message into FCM's `Message` for a token, with the platform blocks that carry what the common
 * `notification` cannot.
 *
 * `data` goes out as given, with the click target under `url` for native clients; the web block gets the icon,
 * badge, image and tag and — for an `https:` target only, since FCM refuses anything else — the link.
 *
 * @param message - The message, with its `token`.
 * @param config - The location's TTL and analytics label.
 * @param now - The current time, for the APNs expiration header.
 * @returns FCM's message.
 */
export const toFcmMessage = (
	message: PushMessage,
	config: Pick<PushDriverFcmConfig, 'ttl' | 'analyticsLabel'> = {},
	now: Date = new Date(),
): TokenMessage => {
	// 1. The message's own ttl wins over the location's; `high` is the one urgency FCM tells apart
	const ttl = message.ttl ?? config.ttl;
	const high = message.urgency === 'high';
	const data = { ...(message.data ?? {}), ...(message.url !== undefined ? { url: message.url } : {}) };
	const collapseId = message.tag?.slice(0, APNS_COLLAPSE_ID_MAX_LENGTH);

	// 2. The common block carries the text; each platform block what only it understands
	return {
		token: message.token as string,
		notification: {
			title: message.title,
			...(message.body !== undefined ? { body: message.body } : {}),
			...(message.image !== undefined ? { imageUrl: message.image } : {}),
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
				...(ttl !== undefined ? { 'apns-expiration': String(Math.floor(now.getTime() / 1000) + ttl) } : {}),
				...(collapseId ? { 'apns-collapse-id': collapseId } : {}),
			},
			// 3. An image needs the app's notification service extension to run: `mutable-content`
			payload: { aps: { sound: 'default', ...(message.image !== undefined ? { 'mutable-content': 1 } : {}) } },
			...(message.image !== undefined ? { fcmOptions: { imageUrl: message.image } } : {}),
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
