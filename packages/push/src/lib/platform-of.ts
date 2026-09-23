import { InvalidPayloadError } from '@novastarter/errors';
import { type PushMessage, type PushPlatform, TOKEN_PLATFORMS } from '../types.js';

/**
 * The hosts of the browser push services a web push subscription may point at; a host matches itself and every
 * subdomain of it.
 *
 * The endpoint comes from the browser, so the client controls it; posting to any https URL would let a user make the
 * server send requests to internal hosts. Only the push services browsers actually hand out are accepted: Chrome and
 * other Chromium browsers (FCM), Firefox (Mozilla autopush), Safari (Apple) and Edge (WNS).
 *
 * @defaultValue `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `push.apple.com`,
 * `notify.windows.com`
 * @internal
 */
const WEB_PUSH_HOSTS: readonly string[] = [
	'fcm.googleapis.com',
	'android.googleapis.com',
	'push.services.mozilla.com',
	'push.apple.com',
	'notify.windows.com',
];

/**
 * The platform a message targets, from which of `subscription` / `token` it carries.
 *
 * @param message - The message.
 * @returns `webpush` for a subscription; for a token, the message's `platform` — `fcm` unless it says `apns`.
 * @throws InvalidPayloadError for a message with neither or both, with a token of an unknown platform, or with a
 * subscription missing its endpoint or keys — a push service would reject it, and a broken subscription must not be
 * mistaken for a gone one; also for an endpoint that is not on a known browser push service, so a client-supplied
 * subscription cannot make the server post to an internal host.
 */
export const platformOf = (message: Pick<PushMessage, 'subscription' | 'token' | 'platform'>): PushPlatform => {
	// 1. Exactly one target: a message to "a subscription or a token" would go through two drivers
	if (message.subscription && message.token) {
		throw new InvalidPayloadError({ reason: 'A push message targets either a subscription or a token, not both' });
	}

	// 2. A blank token would be posted as a real one and refused by the push service; caught here as the payload's
	//    fault, before a driver mistakes the refusal for a gone target
	if (message.token) {
		if (typeof message.token !== 'string' || message.token.trim() === '') {
			throw new InvalidPayloadError({ reason: 'The push token is empty' });
		}

		// 3. A token looks the same on every platform; the message says which one, FCM being the one before APNs came
		const platform = message.platform ?? 'fcm';

		if (!TOKEN_PLATFORMS.includes(platform)) {
			throw new InvalidPayloadError({ reason: `"${String(platform)}" is not a platform a push token belongs to` });
		}

		return platform;
	}

	// 4. Neither target: nothing to route, so the message is refused instead of guessing a platform
	if (!message.subscription) {
		throw new InvalidPayloadError({ reason: 'A push message needs a subscription or a token' });
	}

	// 5. Web push needs the endpoint to post to and both keys to encrypt with; a subscription stored without them
	//    cannot be delivered to and is reported as the payload's problem
	const { endpoint, keys } = message.subscription;

	if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint)) {
		throw new InvalidPayloadError({ reason: 'The push subscription has no https endpoint' });
	}

	// 6. The endpoint is client-supplied, so only a known push service host is posted to; this also rules out IP
	//    literals, `localhost` and internal names without a DNS lookup
	if (!isWebPushHost(endpoint)) {
		throw new InvalidPayloadError({ reason: 'The push subscription endpoint is not a known push service' });
	}

	// 7. Both keys are needed to encrypt the payload for the browser
	if (!keys || typeof keys.p256dh !== 'string' || !keys.p256dh || typeof keys.auth !== 'string' || !keys.auth) {
		throw new InvalidPayloadError({ reason: 'The push subscription has no p256dh / auth keys' });
	}

	return 'webpush';
};

/**
 * Whether a URL's host is one of {@link WEB_PUSH_HOSTS} or a subdomain of one.
 *
 * @param endpoint - The subscription endpoint, already known to start with `https://`.
 * @returns `true` for a known push service host, `false` for any other host or an unparsable URL.
 * @internal
 */
const isWebPushHost = (endpoint: string): boolean => {
	// 1. `URL` resolves the host the request would really go to, so `user@host` and similar tricks do not fool it; an
	//    unparsable endpoint is simply not a push service
	let hostname: string;

	try {
		hostname = new URL(endpoint).hostname.toLowerCase();
	} catch {
		return false;
	}

	// 2. A trailing dot names the same host in DNS, so it is dropped before matching
	const host = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;

	// 3. Match the host itself or a subdomain, with the dot, so a look-alike such as `evilpush.apple.com` fails
	return WEB_PUSH_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
};
