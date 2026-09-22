import type { PushDriver, PushMessage, PushPlatform, PushResult } from '@novastarter/push';
import { withTimeout } from '@novastarter/utils';
import { ApnsClient, Host } from 'apns2';
import { assertSigningKey } from './assert-signing-key.js';
import { describeError } from './describe-error.js';
import { toApnsNotification } from './to-apns-notification.js';

/**
 * The part of the APNs client the driver uses; the whole client satisfies it, and so does a test double.
 */
export type ApnsSender = Pick<ApnsClient, 'send' | 'close'>;

/**
 * Options accepted by {@link PushDriverApns}.
 *
 * Token-based authentication (an APNs auth key, `.p8`), the way Apple recommends: one key serves every app of the
 * team and never expires.
 */
export type PushDriverApnsConfig = {
	/** The Apple Developer team id (Membership details). */
	teamId: string;
	/** The id of the APNs auth key (Certificates, Identifiers & Profiles → Keys). */
	keyId: string;
	/** The auth key's PEM (`-----BEGIN PRIVATE KEY-----`), the text of the `.p8` file. */
	signingKey: string;
	/** The app's bundle id — the `apns-topic` of every push. */
	topic: string;
	/** Send through the production APNs; `false` for the sandbox that development builds register with. */
	production?: boolean | undefined;
	/** APNs hostname (port 443), overriding `production`; the client takes no port. */
	host?: string | undefined;
	/** Seconds APNs keeps a message for an offline device when the message sets none; `0` delivers once or never. */
	ttl?: number | undefined;
	/** Sound of a notification; `default` unless given, empty for a silent one. */
	sound?: string | undefined;
	/**
	 * Milliseconds a send may take before it fails with a timeout error; only the HTTP client's own limits, minutes
	 * long, bound it unless given.
	 */
	requestTimeout?: number | undefined;
	/**
	 * A ready client, for tests; built from the credentials otherwise.
	 *
	 * @internal
	 */
	client?: ApnsSender | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/push`, so a location naming `apns` has its options
 * checked against {@link PushDriverApnsConfig}.
 */
declare module '@novastarter/push' {
	interface PushDrivers {
		apns: PushDriverApnsConfig;
	}
}

/**
 * Driver for the [Apple Push Notification service](https://developer.apple.com/documentation/usernotifications),
 * through the `apns2` client (HTTP/2, token-based auth).
 *
 * A token APNs reports as unregistered, bad, or of another app is dead and is reported as
 * {@link PushTargetGoneError}.
 *
 * @example
 * ```ts
 * import { usePush } from '@novastarter/push';
 * import { PushDriverApns } from '@novastarter/push-driver-apns';
 * import { env } from './env';
 *
 * const push = usePush();
 *
 * push.registerDriver('apns', PushDriverApns);
 * push.registerLocation('apns', {
 * 	driver: 'apns',
 * 	options: {
 * 		teamId: env.PUSH_APNS_TEAM_ID,
 * 		keyId: env.PUSH_APNS_KEY_ID,
 * 		signingKey: env.PUSH_APNS_SIGNING_KEY,
 * 		topic: env.PUSH_APNS_TOPIC,
 * 	},
 * });
 * ```
 */
export class PushDriverApns implements PushDriver {
	/**
	 * Device tokens of iOS / macOS apps only.
	 */
	readonly platforms: readonly PushPlatform[] = ['apns'];

	/**
	 * Topic, ttl, sound and request timeout, as the location was registered with, the signing key with its newlines
	 * restored.
	 *
	 * @internal
	 */
	private readonly config: PushDriverApnsConfig;

	/**
	 * The HTTP/2 client the notifications go through.
	 *
	 * @internal
	 */
	private readonly client: ApnsSender;

	/**
	 * Create a driver on an APNs auth key, with an HTTP/2 client of its own.
	 *
	 * @param config - Credentials, topic, environment and defaults.
	 * @throws Error without the team id, the key id, the signing key or the topic, or with a key that is not an
	 * APNs auth key.
	 */
	constructor(config: PushDriverApnsConfig) {
		// 1. Missing credentials are a configuration error; reported by the options' names
		if (!config.teamId || !config.keyId || !config.signingKey) {
			throw new Error('The apns push driver needs "teamId", "keyId" and "signingKey"');
		}

		if (!config.topic) {
			throw new Error('The apns push driver needs the app\'s bundle id as "topic"');
		}

		// 2. A PEM in a `.env` line has its newlines as the two characters `\n`; the signer needs real ones. The key is
		//    checked now, so a broken secret fails at startup rather than on the first push
		const signingKey = config.signingKey.replace(/\\n/g, '\n');

		assertSigningKey(signingKey);
		this.config = { ...config, signingKey };

		// 3. Production unless told otherwise: a token from a development build only works with the sandbox, and
		//    APNs answers `BadDeviceToken` across environments. The client takes a `requestTimeout` but never reads
		//    it, so the deadline is not handed over: `send()` keeps it
		const host = config.host ?? (config.production === false ? Host.development : Host.production);

		this.client =
			config.client ??
			new ApnsClient({
				team: config.teamId,
				keyId: config.keyId,
				signingKey,
				defaultTopic: config.topic,
				host,
			});
	}

	/**
	 * Send through APNs.
	 *
	 * @param message - The message, with a token.
	 * @returns `accepted`; APNs hands out no id the client exposes.
	 * @throws PushTargetGoneError when APNs says the token is unregistered, bad, or of another app.
	 * @throws Error naming the deadline when `requestTimeout` passes before APNs answers, the `TimeoutError` of
	 * `@novastarter/utils` as the cause; the request itself runs on, since the HTTP client cannot be told to stop.
	 * @throws Error naming APNs's status and reason otherwise, the SDK's error as the cause.
	 */
	async send(message: PushMessage): Promise<PushResult> {
		// 1. A subscription cannot be delivered here; `sendPush()` routes by platform, but a direct caller may not
		if (!message.token) {
			throw new Error('The apns push driver needs a token; a subscription belongs to the webpush driver');
		}

		// 2. The client resolves on a 200 and throws an `ApnsError` with Apple's reason otherwise. It ignores the
		//    timeout it is given, so the deadline is raced here: a stalled connection would otherwise sit out the
		//    HTTP client's minutes-long limits, and a queue job around the send with it
		try {
			const request = this.client.send(toApnsNotification(message, this.config));

			await (this.config.requestTimeout === undefined ? request : withTimeout(request, this.config.requestTimeout));

			return { status: 'accepted' };
		} catch (error) {
			throw describeError(error);
		}
	}

	/**
	 * Check the credentials without sending: the signing key parses and is the kind APNs takes.
	 *
	 * APNs validates the team, the key id and the topic only on a push, so a wrong id shows up as
	 * `InvalidProviderToken` or `TopicDisallowed` on the first message rather than here.
	 *
	 * @throws Error when the key is not an APNs auth key.
	 */
	async verify(): Promise<void> {
		// 1. The key is the one thing checkable offline; the ids and the topic only APNs can judge
		assertSigningKey(this.config.signingKey);
	}

	/**
	 * Close the HTTP/2 connections, whose keep-alive pings would otherwise keep the process alive.
	 */
	async close(): Promise<void> {
		// 1. The client owns the sessions, injected or not: a test double's `close` is a no-op
		await this.client.close();
	}
}
