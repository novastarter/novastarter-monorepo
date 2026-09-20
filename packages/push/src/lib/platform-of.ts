import { InvalidPayloadError } from '@novastarter/errors';
import { type PushMessage, type PushPlatform, TOKEN_PLATFORMS } from '../types.js';

/**
 * The platform a message targets, from which of `subscription` / `token` it carries.
 *
 * @param message - The message.
 * @returns `webpush` for a subscription; for a token, the message's `platform` — `fcm` unless it says `apns`.
 * @throws InvalidPayloadError for a message with neither or both, with a token of an unknown platform, or with a
 * subscription missing its endpoint or keys — a push service would reject it, and a broken subscription must not be
 * mistaken for a gone one.
 */
export const platformOf = (message: Pick<PushMessage, 'subscription' | 'token' | 'platform'>): PushPlatform => {
	// 1. Exactly one target: a message to "a subscription or a token" would go through two drivers
	if (message.subscription && message.token) {
		throw new InvalidPayloadError({ reason: 'A push message targets either a subscription or a token, not both' });
	}

	if (message.token) {
		if (typeof message.token !== 'string' || message.token.trim() === '') {
			throw new InvalidPayloadError({ reason: 'The push token is empty' });
		}

		// 2. A token looks the same on every platform; the message says which one, FCM being the one before APNs came
		const platform = message.platform ?? 'fcm';

		if (!TOKEN_PLATFORMS.includes(platform)) {
			throw new InvalidPayloadError({ reason: `"${String(platform)}" is not a platform a push token belongs to` });
		}

		return platform;
	}

	if (!message.subscription) {
		throw new InvalidPayloadError({ reason: 'A push message needs a subscription or a token' });
	}

	// 3. Web push needs the endpoint to post to and both keys to encrypt with; a subscription stored without them
	//    cannot be delivered to and is reported as the payload's problem
	const { endpoint, keys } = message.subscription;

	if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint)) {
		throw new InvalidPayloadError({ reason: 'The push subscription has no https endpoint' });
	}

	if (!keys || typeof keys.p256dh !== 'string' || !keys.p256dh || typeof keys.auth !== 'string' || !keys.auth) {
		throw new InvalidPayloadError({ reason: 'The push subscription has no p256dh / auth keys' });
	}

	return 'webpush';
};
