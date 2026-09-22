import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import {
	type PushDriver,
	type PushMessage,
	type PushPlatform,
	type PushResult,
	toWebPushPayload,
} from '@novastarter/push';
import { toErrorMessage } from '@novastarter/utils';
import webpush, { type ContentEncoding, type PushSubscription, type RequestOptions, type SendResult } from 'web-push';
import { VERIFY_AUDIENCE } from './constants.js';
import { describeError } from './describe-error.js';
import { toRequestOptions } from './to-request-options.js';

/**
 * The function that posts to the push service — `sendNotification` of `web-push`.
 */
type SendNotification = (
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
 * Driver for the [Web Push protocol](https://datatracker.ietf.org/doc/html/rfc8030) with VAPID — browsers' own push
 * services (Chrome, Firefox, Safari, Edge), through `web-push`.
 *
 * The payload is the JSON of `toWebPushPayload()`, encrypted for the subscription; the app's service worker shows
 * it. A `404` / `410` from the push service means the subscription is dead and is reported as
 * {@link PushTargetGoneError}.
 *
 * @example
 * ```ts
 * import { usePush } from '@novastarter/push';
 * import { PushDriverWebPush } from '@novastarter/push-driver-webpush';
 * import { env } from './env';
 *
 * const push = usePush();
 *
 * push.registerDriver('webpush', PushDriverWebPush);
 * push.registerLocation('webpush', {
 * 	driver: 'webpush',
 * 	options: {
 * 		publicKey: env.PUSH_WEBPUSH_PUBLIC_KEY,
 * 		privateKey: env.PUSH_WEBPUSH_PRIVATE_KEY,
 * 		subject: env.PUSH_WEBPUSH_SUBJECT,
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
	 * What posts to the push service: the library's `sendNotification`.
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
		this.sendNotification = webpush.sendNotification;
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
			throw new Error(`Web push VAPID keys are invalid: ${toErrorMessage(error)}`, { cause: error });
		}
	}
}
