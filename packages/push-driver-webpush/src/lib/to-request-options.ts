import type { PushMessage } from '@novastarter/push';
import type { RequestOptions } from 'web-push';
import { TOPIC_MAX_LENGTH } from './constants.js';
import type { PushDriverWebPushConfig } from './driver.js';

/**
 * A collapse tag as the Web Push `Topic` header takes it: at most 32 URL-safe base64 characters.
 *
 * @param tag - Free text.
 * @returns The tag with anything else replaced by `_`, cut to the limit; `undefined` for an empty one.
 */
export const toTopic = (tag: string | undefined): string | undefined => {
	if (!tag) return undefined;

	// The push services refuse anything outside the URL-safe alphabet, and anything longer than the limit
	const topic = tag.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, TOPIC_MAX_LENGTH);

	return topic || undefined;
};

/**
 * Translate a message into the request options of `sendNotification()`.
 *
 * @param message - The message.
 * @param config - The location's keys, subject and defaults.
 * @returns The options: VAPID details, TTL, urgency, topic, encoding, timeout and proxy.
 */
export const toRequestOptions = (
	message: PushMessage,
	config: Pick<
		PushDriverWebPushConfig,
		'publicKey' | 'privateKey' | 'subject' | 'ttl' | 'contentEncoding' | 'timeout' | 'proxy'
	>,
): RequestOptions => {
	const ttl = message.ttl ?? config.ttl;
	const topic = toTopic(message.tag);

	// Optional fields are only set when present, so the library sees no `undefined` keys
	return {
		vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
		contentEncoding: config.contentEncoding ?? 'aes128gcm',
		urgency: message.urgency ?? 'normal',
		...(ttl !== undefined ? { TTL: ttl } : {}),
		...(topic !== undefined ? { topic } : {}),
		...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
		...(config.proxy !== undefined ? { proxy: config.proxy } : {}),
	};
};
