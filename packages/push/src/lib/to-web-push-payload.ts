import type { PushMessage, WebPushPayload } from '../types.js';

/**
 * The JSON a web push carries, for the service worker.
 *
 * The click target goes into `data.url` rather than a top-level field, since `showNotification()` keeps `data` on
 * the notification and the worker reads it back in `notificationclick`.
 *
 * @param message - The message.
 * @returns The payload; undefined fields left out, so the JSON stays small (a push payload is capped at 4 KB).
 */
export const toWebPushPayload = (message: PushMessage): WebPushPayload => {
	// 1. The title is the only required field; every optional one stays out of the JSON, which is capped at 4 KB, and
	//    the click target rides in `data.url` since `showNotification()` keeps `data` on the notification for the
	//    worker to read back in `notificationclick`
	return {
		title: message.title,
		...(message.body !== undefined ? { body: message.body } : {}),
		...(message.icon !== undefined ? { icon: message.icon } : {}),
		...(message.image !== undefined ? { image: message.image } : {}),
		...(message.badge !== undefined ? { badge: message.badge } : {}),
		...(message.tag !== undefined ? { tag: message.tag } : {}),
		data: { ...(message.data ?? {}), ...(message.url !== undefined ? { url: message.url } : {}) },
	};
};
