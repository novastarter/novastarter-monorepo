import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import {
	type PushDriver,
	type PushMessage,
	type PushPlatform,
	type PushResult,
	PushTargetGoneError,
	toWebPushPayload,
} from '@novastarter/push';
import webpush, {
	type ContentEncoding,
	type PushSubscription,
	type RequestOptions,
	type SendResult,
	WebPushError,
} from 'web-push';

/**
 * The function that posts to the push service — `sendNotification` of `web-push`, or a test double.
 */
export type SendNotification = (
	subscription: PushSubscription,
	payload: string,
	options: RequestOptions,
) => Promise<SendResult>;

/**
 * Options accepted by {@link PushDriverWebPush}.
 */
export type PushDriverWebPushConfig = {
	/** VAPID public key, URL-safe base64 — what the browser subscribes with (`applicationServerKey`). */
	publicKey: string;
	/** VAPID private key, URL-safe base64. */
	privateKey: string;
	/** Who the push service may contact about the sender: a `mailto:` address or an `https:` URL. */
	subject: string;
	/** How long the push service keeps a message for an offline device, in seconds; four weeks unless given. */
	ttl?: number | undefined;
	/** Payload encoding; `aes128gcm` (RFC 8188, every current browser) unless given. */
	contentEncoding?: ContentEncoding | undefined;
	/** Socket timeout of a request in milliseconds. */
	timeout?: number | undefined;
	/** Proxy URL for the requests to the push services. */
	proxy?: string | undefined;
	/** A `sendNotification`, for tests; the library's otherwise. */
	sendNotification?: SendNotification | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/push`, so a location naming `webpush` has its options
 * checked against {@link PushDriverWebPushConfig}.
 */
declare module '@novastarter/push' {
	interface PushDrivers {
		webpush: PushDriverWebPushConfig;
	}
}

/**
 * HTTP statuses a push service answers for a subscription that no longer exists.
 *
 * @defaultValue 404 (Firefox, Safari), 410 (Chrome, Edge)
 */
export const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

/**
 * Longest topic a push service takes (RFC 8030 §5.4).
 *
 * @defaultValue 32
 */
export const TOPIC_MAX_LENGTH = 32;

/**
 * The origin every push service answers — used to sign a test token in {@link PushDriverWebPush.verify}.
 *
 * @defaultValue `https://fcm.googleapis.com`
 */
export const VERIFY_AUDIENCE = 'https://fcm.googleapis.com';

/**
 * A collapse tag as the Web Push `Topic` header takes it: at most 32 URL-safe base64 characters.
 *
 * @param tag - Free text.
 * @returns The tag with anything else replaced by `_`, cut to the limit; `undefined` for an empty one.
 */
export const toTopic = (tag: string | undefined): string | undefined => {
	// 1. No tag, no header
	if (!tag) return undefined;

	// 2. The push services refuse anything outside the URL-safe alphabet, and anything longer than the limit
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
	// 1. The message's own TTL wins over the location's default; the tag becomes the collapse topic
	const ttl = message.ttl ?? config.ttl;
	const topic = toTopic(message.tag);

	// 2. Optional fields are only set when present, so the library sees no `undefined` keys
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

/**
 * Turn what `web-push` throws into the error `sendPush()` expects.
 *
 * @param error - What was thrown: a `WebPushError` for a non-2xx answer, a plain error for the network.
 * @returns A {@link PushTargetGoneError} for a dead subscription, else an error naming the status and body with the
 * original as its cause.
 */
export const describeError = (error: unknown): Error => {
	// 1. The push service answered: 404 / 410 mean the subscription is gone for good
	if (error instanceof WebPushError) {
		if (GONE_STATUSES.has(error.statusCode)) {
			return new PushTargetGoneError({ platform: 'webpush', reason: `${error.statusCode} from ${error.endpoint}` });
		}

		const body = error.body?.trim();

		return new Error(`Web push: ${error.statusCode} from ${error.endpoint}${body ? `: ${body}` : ''}`, {
			cause: error,
		});
	}

	// 2. Anything else — the network, a bad key — as is, prefixed
	return new Error(`Web push: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
};

/**
 * Driver for the [Web Push protocol](https://datatracker.ietf.org/doc/html/rfc8030) with VAPID — browsers' own push
 * services (Chrome, Firefox, Safari, Edge), through `web-push`.
 *
 * The payload is the JSON of `toWebPushPayload()`, encrypted for the subscription; the app's service worker shows
 * it. A `404` / `410` from the push service means the subscription is dead and is reported as
 * {@link PushTargetGoneError}.
 *
 * @example
 * ```ts
 * usePush().registerDriver('webpush', PushDriverWebPush);
 * usePush().registerLocation('webpush', {
 * 	driver: 'webpush',
 * 	options: {
 * 		publicKey: env['PUSH_WEBPUSH_PUBLIC_KEY'],
 * 		privateKey: env['PUSH_WEBPUSH_PRIVATE_KEY'],
 * 		subject: env['PUSH_WEBPUSH_SUBJECT'],
 * 	},
 * });
 * ```
 */
export class PushDriverWebPush implements PushDriver {
	/**
	 * Browser subscriptions only.
	 */
	readonly platforms: readonly PushPlatform[] = ['webpush'];

	/**
	 * The VAPID public key — what a browser subscribes with through this location.
	 */
	readonly applicationServerKey: string;

	/**
	 * Keys, subject and defaults, as the location was registered with.
	 *
	 * @internal
	 */
	private readonly config: PushDriverWebPushConfig;

	/**
	 * What posts to the push service: the library's `sendNotification`, or the test double.
	 *
	 * @internal
	 */
	private readonly sendNotification: SendNotification;

	/**
	 * Create a driver on a VAPID key pair.
	 *
	 * @param config - Keys, subject and defaults.
	 * @throws Error without a public key, a private key or a subject, or with a subject that is neither `mailto:`
	 * nor `https:` — the push services refuse such a VAPID token.
	 */
	constructor(config: PushDriverWebPushConfig) {
		// 1. Missing keys are a configuration error; reported by the options' names, with the command that makes a pair
		if (!config.publicKey || !config.privateKey) {
			throw new Error(
				'The webpush push driver needs a "publicKey" and a "privateKey" (generate them with `npx web-push generate-vapid-keys`)',
			);
		}

		// 2. The subject is what a push service contacts about abuse; it takes exactly two forms
		if (!config.subject || !/^(mailto:|https:\/\/)/.test(config.subject)) {
			throw new Error('The webpush push driver needs a "subject" that is a mailto: address or an https: URL');
		}

		this.config = config;
		this.applicationServerKey = config.publicKey;
		this.sendNotification = config.sendNotification ?? webpush.sendNotification;
	}

	/**
	 * Post the encrypted payload to the subscription's push service.
	 *
	 * @param message - The message, with its `subscription`.
	 * @returns The push service's HTTP status as the status; there is no message id.
	 * @throws PushTargetGoneError for a `404` / `410`.
	 * @throws Error carrying the status and body for any other refusal, or the network error.
	 */
	async send(message: PushMessage): Promise<PushResult> {
		const subscription = message.subscription;

		// 1. A token cannot be delivered here; `sendPush()` routes by platform, but a direct caller may not
		if (!subscription) {
			throw new Error('The webpush push driver needs a subscription; a token belongs to the fcm or apns driver');
		}

		// 2. The library's subscription shape: `expirationTime` only when known, as `exactOptionalPropertyTypes` wants
		const target: PushSubscription = {
			endpoint: subscription.endpoint,
			keys: subscription.keys,
			...(subscription.expirationTime !== undefined ? { expirationTime: subscription.expirationTime } : {}),
		};

		// 3. The library encrypts the payload for the subscription and signs the request with the keys
		try {
			const result = await this.sendNotification(
				target,
				JSON.stringify(toWebPushPayload(message)),
				toRequestOptions(message, this.config),
			);

			return { status: String(result.statusCode) };
		} catch (error) {
			throw describeError(error);
		}
	}

	/**
	 * Check the keys are a P-256 pair and the subject is accepted, without contacting a push service.
	 *
	 * `web-push` only checks the lengths when it signs, so a public key from one pair and a private key from another
	 * would pass and every push would then be refused with a 403 — the pair is proven by signing with the private key
	 * and verifying with the public one.
	 *
	 * @throws Error when the keys do not decode, are not a pair, or the subject is refused.
	 */
	async verify(): Promise<void> {
		try {
			// 1. The library's own checks: key lengths, the subject, a signed token
			webpush.getVapidHeaders(
				VERIFY_AUDIENCE,
				this.config.subject,
				this.config.publicKey,
				this.config.privateKey,
				this.config.contentEncoding ?? 'aes128gcm',
			);

			// 2. The pair: the public key is the uncompressed point `04 || x || y`, the private key the scalar `d`
			const point = Buffer.from(this.config.publicKey, 'base64url');
			const x = point.subarray(1, 33).toString('base64url');
			const y = point.subarray(33, 65).toString('base64url');

			const privateKey = createPrivateKey({
				key: { kty: 'EC', crv: 'P-256', d: this.config.privateKey, x, y },
				format: 'jwk',
			});

			const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x, y }, format: 'jwk' });
			const challenge = Buffer.from(VERIFY_AUDIENCE);

			// 3. A signature only verifies with the public half of the key that made it
			if (!verify('sha256', challenge, publicKey, sign('sha256', challenge, privateKey))) {
				throw new Error('the public and the private key are not a pair');
			}
		} catch (error) {
			throw new Error(`Web push VAPID keys are invalid: ${error instanceof Error ? error.message : String(error)}`, {
				cause: error,
			});
		}
	}
}

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default PushDriverWebPush;
