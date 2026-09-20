import { randomUUID } from 'node:crypto';
import {
	type PushDriver,
	type PushMessage,
	type PushPlatform,
	type PushResult,
	PushTargetGoneError,
} from '@novastarter/push';
import { type App, cert, type Credential, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging, type TokenMessage } from 'firebase-admin/messaging';

/**
 * A service account as the Firebase console downloads it, or with the same fields camel-cased.
 */
export type ServiceAccountJson = {
	project_id?: string | undefined;
	client_email?: string | undefined;
	private_key?: string | undefined;
	projectId?: string | undefined;
	clientEmail?: string | undefined;
	privateKey?: string | undefined;
};

/**
 * Options accepted by {@link PushDriverFcm}.
 *
 * The credentials are the service account: either its JSON in `serviceAccount` — the text of the file the Firebase
 * console downloads, or the parsed object — or its three fields on their own.
 */
export type PushDriverFcmConfig = {
	/** The service account JSON, as text or parsed. */
	serviceAccount?: string | ServiceAccountJson | undefined;
	/** The Firebase project id. */
	projectId?: string | undefined;
	/** The service account's email. */
	clientEmail?: string | undefined;
	/** The service account's PEM private key; `\n` escapes, as an env file carries them, are unescaped. */
	privateKey?: string | undefined;
	/** How long FCM keeps a message for an offline device, in seconds; FCM's four weeks unless given. */
	ttl?: number | undefined;
	/** Label the messages carry into the Firebase analytics, for the console's delivery reports. */
	analyticsLabel?: string | undefined;
	/** A ready `Messaging`, for tests; one on the service account otherwise. */
	messaging?: Pick<Messaging, 'send'> | undefined;
	/** A ready credential, for tests; `cert()` of the service account otherwise. */
	credential?: Credential | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/push`, so a location naming `fcm` has its options
 * checked against {@link PushDriverFcmConfig}.
 */
declare module '@novastarter/push' {
	interface PushDrivers {
		fcm: PushDriverFcmConfig;
	}
}

/**
 * FCM error codes that mean the token is dead — what Firebase says to delete the token on.
 *
 * @defaultValue `messaging/registration-token-not-registered`, `messaging/invalid-registration-token`
 */
export const GONE_CODES: ReadonlySet<string> = new Set([
	'messaging/registration-token-not-registered',
	'messaging/invalid-registration-token',
]);

/**
 * Longest `apns-collapse-id` APNs takes, in bytes.
 *
 * @defaultValue 64
 */
export const APNS_COLLAPSE_ID_MAX_LENGTH = 64;

/**
 * The service account fields out of the configuration, whichever way they were given.
 *
 * @param config - The location's configuration.
 * @returns `projectId`, `clientEmail` and `privateKey` with its newlines restored.
 * @throws Error for `serviceAccount` text that is not JSON.
 */
export const readServiceAccount = (
	config: Pick<PushDriverFcmConfig, 'serviceAccount' | 'projectId' | 'clientEmail' | 'privateKey'>,
): { projectId: string | undefined; clientEmail: string | undefined; privateKey: string | undefined } => {
	let json: ServiceAccountJson = {};

	// 1. The JSON wins as a whole; the separate fields fill what it does not carry
	if (typeof config.serviceAccount === 'string') {
		try {
			json = JSON.parse(config.serviceAccount) as ServiceAccountJson;
		} catch (error) {
			throw new Error('The fcm push driver got a "serviceAccount" that is not JSON', { cause: error });
		}
	} else if (config.serviceAccount) {
		json = config.serviceAccount;
	}

	const privateKey = json.private_key ?? json.privateKey ?? config.privateKey;

	// 2. A PEM in a `.env` line has its newlines as the two characters `\n`; the SDK needs real ones
	return {
		projectId: json.project_id ?? json.projectId ?? config.projectId,
		clientEmail: json.client_email ?? json.clientEmail ?? config.clientEmail,
		privateKey: privateKey?.replace(/\\n/g, '\n'),
	};
};

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

/**
 * Driver for [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging) — native Android and iOS
 * apps and browsers on the Firebase SDK, through `firebase-admin`.
 *
 * One Firebase app per location, under a name of its own, so two locations on two projects do not collide. A token
 * FCM reports as not registered or invalid is dead and is reported as {@link PushTargetGoneError}.
 *
 * @example
 * ```ts
 * usePush().registerDriver('fcm', PushDriverFcm);
 * usePush().registerLocation('fcm', {
 * 	driver: 'fcm',
 * 	options: {
 * 		serviceAccount: env['PUSH_FCM_SERVICE_ACCOUNT'],
 * 	},
 * });
 * ```
 */
export class PushDriverFcm implements PushDriver {
	/**
	 * Registration tokens of the Firebase SDK only.
	 */
	readonly platforms: readonly PushPlatform[] = ['fcm'];

	/**
	 * TTL and analytics label, as the location was registered with.
	 *
	 * @internal
	 */
	private readonly config: PushDriverFcmConfig;

	/**
	 * The service account's credential — what `verify()` fetches an access token with.
	 *
	 * @internal
	 */
	private readonly credential: Credential;

	/**
	 * The messaging client the messages go through.
	 *
	 * @internal
	 */
	private readonly messaging: Pick<Messaging, 'send'>;

	/**
	 * The Firebase app of this location; `undefined` when a messaging client was injected.
	 *
	 * @internal
	 */
	private readonly app: App | undefined;

	/**
	 * Create a driver on a service account, with a Firebase app of its own.
	 *
	 * @param config - Service account and defaults.
	 * @throws Error without a project id, a client email or a private key, or with a private key that is not a PEM
	 * — `cert()` checks the key parses.
	 */
	constructor(config: PushDriverFcmConfig) {
		// 1. Missing credentials are a configuration error; reported by the options' names
		const account = readServiceAccount(config);

		if (!config.credential && (!account.projectId || !account.clientEmail || !account.privateKey)) {
			throw new Error(
				'The fcm push driver needs a service account: "serviceAccount", or "projectId", "clientEmail" and "privateKey"',
			);
		}

		this.config = config;

		// 2. `cert()` validates the fields and parses the key, so a broken secret fails at startup
		this.credential =
			config.credential ??
			cert({ projectId: account.projectId!, clientEmail: account.clientEmail!, privateKey: account.privateKey! });

		// 3. Its own Firebase app, unless a messaging client was injected: the SDK keeps apps in a global registry by
		//    name, and the default name would clash with a second location or with the app's own Firebase use
		if (config.messaging) {
			this.messaging = config.messaging;
		} else {
			this.app = initializeApp(
				{ credential: this.credential, ...(account.projectId ? { projectId: account.projectId } : {}) },
				`novastarter-push-${randomUUID()}`,
			);

			this.messaging = getMessaging(this.app);
		}
	}

	/**
	 * Send through the FCM HTTP v1 API.
	 *
	 * @param message - The message, with its `token`.
	 * @returns FCM's message name (`projects/<id>/messages/<id>`) as the id.
	 * @throws PushTargetGoneError for a token FCM no longer knows.
	 * @throws Error carrying FCM's error code for any other refusal, or the network error.
	 */
	async send(message: PushMessage): Promise<PushResult> {
		// 1. A subscription cannot be delivered here; `sendPush()` routes by platform, but a direct caller may not
		if (!message.token) {
			throw new Error('The fcm push driver needs a token; a subscription belongs to the webpush driver');
		}

		// 2. The SDK answers the message name on success and throws a coded error otherwise
		try {
			const messageId = await this.messaging.send(toFcmMessage(message, this.config));

			return { messageId, status: 'accepted' };
		} catch (error) {
			throw describeError(error);
		}
	}

	/**
	 * Fetch an OAuth access token with the service account — what every request does — to prove the credentials.
	 *
	 * @throws Error when Google refuses the service account.
	 */
	async verify(): Promise<void> {
		// 1. The token request is what every send does first; refused here means refused on every push
		try {
			await this.credential.getAccessToken();
		} catch (error) {
			throw new Error(`FCM credentials are invalid: ${error instanceof Error ? error.message : String(error)}`, {
				cause: error,
			});
		}
	}

	/**
	 * Release the Firebase app — its HTTP agents keep the process alive otherwise.
	 */
	async close(): Promise<void> {
		// 1. Only an app of our own is ours to delete; an injected messaging client belongs to whoever made it
		if (this.app) {
			await deleteApp(this.app);
		}
	}
}

/**
 * Turn what the SDK throws into the error `sendPush()` expects.
 *
 * @param error - What was thrown: a `FirebaseError` with a `messaging/…` code for a refusal, a plain error for the
 * network.
 * @returns A {@link PushTargetGoneError} for a dead token, else an error naming the code with the original as its
 * cause.
 */
export const describeError = (error: unknown): Error => {
	// 1. A refusal by FCM: the code says whether the token is gone. `invalid-argument` covers a malformed token too,
	//    which the message names
	if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
		const gone =
			GONE_CODES.has(error.code) ||
			(error.code === 'messaging/invalid-argument' && /registration token/i.test(error.message));

		if (gone) {
			return new PushTargetGoneError({ platform: 'fcm', reason: error.code });
		}

		return new Error(`FCM ${error.code}: ${error.message}`, { cause: error });
	}

	// 2. Anything else — the network, a bug — as is, prefixed
	return new Error(`FCM: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
};

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default PushDriverFcm;
