import { createPrivateKey } from 'node:crypto';
import {
	type PushDriver,
	type PushMessage,
	type PushPlatform,
	type PushResult,
	PushTargetGoneError,
} from '@novastarter/push';
import { ApnsClient, ApnsError, Errors, Host, Notification, type NotificationOptions, Priority } from 'apns2';

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
	/** Request timeout in milliseconds; the SDK's default unless given. */
	requestTimeout?: number | undefined;
	/** A ready client, for tests; built from the credentials otherwise. */
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
 * APNs reasons that mean the device token is dead: the app was deleted, the token belongs to another app, or the
 * token never was one.
 *
 * @defaultValue `Unregistered`, `BadDeviceToken`, `DeviceTokenNotForTopic`
 */
export const GONE_REASONS: ReadonlySet<string> = new Set([
	Errors.unregistered,
	Errors.badDeviceToken,
	Errors.deviceTokenNotForTopic,
]);

/**
 * Longest `apns-collapse-id` APNs accepts.
 *
 * @defaultValue 64 bytes.
 */
export const COLLAPSE_ID_MAX_LENGTH = 64;

/**
 * The APNs priority of a message's urgency: `high` wakes the device now, `normal` lets APNs batch, the low ones wait
 * for a power-friendly moment.
 *
 * @param urgency - The message's urgency.
 * @returns APNs's 10, 5 or 1.
 */
export const toApnsPriority = (urgency: PushMessage['urgency']): Priority => {
	// 1. Three levels on Apple's side for four on ours: both low ones wait for a power-friendly moment
	if (urgency === 'high') return Priority.immediate;
	if (urgency === 'low' || urgency === 'very-low') return Priority.low;

	return Priority.throttled;
};

/**
 * Translate a message into the APNs notification for its token.
 *
 * The title and body go under `aps.alert`; the click target, the image and the custom pairs are top-level keys of
 * the payload, for the app to read (`url`, `image`, then `data`); an image sets `mutable-content` so the app's
 * notification service extension can attach it. The tag is the collapse id, the ttl the expiration.
 *
 * @param message - Ours, with a token.
 * @param config - The location's topic, ttl and sound.
 * @param now - The clock, for the expiration; the current time unless given.
 * @returns The notification.
 */
export const toApnsNotification = (
	message: PushMessage,
	config: Pick<PushDriverApnsConfig, 'topic' | 'ttl' | 'sound'>,
	now: Date = new Date(),
): Notification => {
	// 1. The message's own ttl wins over the location's; the custom pairs carry the click target and the image
	const ttl = message.ttl ?? config.ttl;
	const sound = config.sound ?? 'default';

	const data = {
		...(message.data ?? {}),
		...(message.url !== undefined ? { url: message.url } : {}),
		...(message.image !== undefined ? { image: message.image } : {}),
	};

	// 2. `apns-expiration` is an absolute Unix time; `0` means "deliver now or drop". The alert's body is required by
	//    the client's types; an empty one shows the title alone
	const options: NotificationOptions = {
		type: 'alert',
		topic: config.topic,
		alert: { title: message.title, body: message.body ?? '' },
		priority: toApnsPriority(message.urgency),
		...(ttl !== undefined ? { expiration: ttl > 0 ? Math.floor(now.getTime() / 1000) + ttl : 0 } : {}),
		...(message.tag !== undefined ? { collapseId: message.tag.slice(0, COLLAPSE_ID_MAX_LENGTH) } : {}),
		...(sound ? { sound } : {}),
		...(message.image !== undefined ? { mutableContent: true } : {}),
		...(Object.keys(data).length > 0 ? { data } : {}),
	};

	return new Notification(message.token as string, options);
};

/**
 * Turn what the SDK threw into the error `sendPush()` expects.
 *
 * @param error - The SDK's `ApnsError`, or whatever the network threw.
 * @returns A `PushTargetGoneError` for a dead token, an error naming APNs's status and reason otherwise.
 */
export const describeError = (error: unknown): Error => {
	// 1. A refusal by APNs: the reason says whether the token is gone
	if (error instanceof ApnsError) {
		if (GONE_REASONS.has(error.reason)) {
			return new PushTargetGoneError({ platform: 'apns', reason: error.reason });
		}

		return new Error(`APNs ${error.statusCode} ${error.reason}`, { cause: error });
	}

	// 2. Anything else — the network, a bug — as is, prefixed
	return new Error(`APNs: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
};

/**
 * Check an APNs auth key: a PEM private key on the P-256 curve, which ES256 — the only algorithm APNs takes —
 * signs with.
 *
 * @param pem - The key as given.
 * @throws Error when the PEM does not parse or is not a P-256 EC key.
 */
export const assertSigningKey = (pem: string): void => {
	let key;

	// 1. A key that does not parse is reported by the option's name, the parser's complaint as the cause
	try {
		key = createPrivateKey(pem);
	} catch (error) {
		throw new Error('The apns push driver got a "signingKey" that is not a PEM private key', { cause: error });
	}

	// 2. An RSA key or another curve would produce a JWT APNs answers `InvalidProviderToken` to
	if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
		throw new Error('The apns push driver needs a P-256 EC key (an APNs auth key, .p8) as "signingKey"');
	}
};

/**
 * Driver for the [Apple Push Notification service](https://developer.apple.com/documentation/usernotifications),
 * through the `apns2` client (HTTP/2, token-based auth).
 *
 * A token APNs reports as unregistered, bad, or of another app is dead and is reported as
 * {@link PushTargetGoneError}.
 *
 * @example
 * ```ts
 * usePush().registerDriver('apns', PushDriverApns);
 * usePush().registerLocation('apns', {
 * 	driver: 'apns',
 * 	options: {
 * 		teamId: env['PUSH_APNS_TEAM_ID'],
 * 		keyId: env['PUSH_APNS_KEY_ID'],
 * 		signingKey: env['PUSH_APNS_SIGNING_KEY'],
 * 		topic: env['PUSH_APNS_TOPIC'],
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
	 * Topic, ttl and sound, as the location was registered with, the signing key with its newlines restored.
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
		//    APNs answers `BadDeviceToken` across environments
		const host = config.host ?? (config.production === false ? Host.development : Host.production);

		this.client =
			config.client ??
			new ApnsClient({
				team: config.teamId,
				keyId: config.keyId,
				signingKey,
				defaultTopic: config.topic,
				host,
				...(config.requestTimeout !== undefined ? { requestTimeout: config.requestTimeout } : {}),
			});
	}

	/**
	 * Send through APNs.
	 *
	 * @param message - The message, with a token.
	 * @returns `accepted`; APNs hands out no id the client exposes.
	 * @throws PushTargetGoneError when APNs says the token is unregistered, bad, or of another app.
	 * @throws Error naming APNs's status and reason otherwise, the SDK's error as the cause.
	 */
	async send(message: PushMessage): Promise<PushResult> {
		// 1. A subscription cannot be delivered here; `sendPush()` routes by platform, but a direct caller may not
		if (!message.token) {
			throw new Error('The apns push driver needs a token; a subscription belongs to the webpush driver');
		}

		// 2. The client resolves on a 200 and throws an `ApnsError` with Apple's reason otherwise
		try {
			await this.client.send(toApnsNotification(message, this.config));

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

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default PushDriverApns;
