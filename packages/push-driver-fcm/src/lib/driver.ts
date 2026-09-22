import { randomUUID } from 'node:crypto';
import type { PushDriver, PushMessage, PushPlatform, PushResult } from '@novastarter/push';
import { toErrorMessage, withTimeout } from '@novastarter/utils';
import { type App, cert, type Credential, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { describeError } from './describe-error.js';
import { readServiceAccount, type ServiceAccountJson } from './read-service-account.js';
import { toFcmMessage } from './to-fcm-message.js';

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
	/**
	 * How long FCM keeps a message for an offline device, in seconds; `0` is "now or never". FCM's four weeks unless
	 * given.
	 */
	ttl?: number | undefined;
	/** Label the messages carry into the Firebase analytics, for the console's delivery reports. */
	analyticsLabel?: string | undefined;
	/**
	 * Milliseconds a send may take before it fails with a timeout error; only the HTTP client's own limits, minutes
	 * long, bound it unless given. The request itself runs on when the deadline passes, since the SDK call cannot be
	 * told to stop.
	 */
	timeout?: number | undefined;
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
 * Driver for [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging) — native Android and iOS
 * apps and browsers on the Firebase SDK, through `firebase-admin`.
 *
 * One Firebase app per location, under a name of its own, so two locations on two projects do not collide. A token
 * FCM reports as not registered or invalid is dead and is reported as {@link PushTargetGoneError}.
 *
 * @example
 * ```ts
 * import { usePush } from '@novastarter/push';
 * import { PushDriverFcm } from '@novastarter/push-driver-fcm';
 * import { env } from './env';
 *
 * const push = usePush();
 *
 * push.registerDriver('fcm', PushDriverFcm);
 * push.registerLocation('fcm', {
 * 	driver: 'fcm',
 * 	options: {
 * 		serviceAccount: env.PUSH_FCM_SERVICE_ACCOUNT,
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
	 * TTL, analytics label and timeout, as the location was registered with.
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
	 * The Firebase app of this location.
	 *
	 * @internal
	 */
	private readonly app: App;

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

		if (!account.projectId || !account.clientEmail || !account.privateKey) {
			throw new Error(
				'The fcm push driver needs a service account: "serviceAccount", or "projectId", "clientEmail" and "privateKey"',
			);
		}

		this.config = config;

		// 2. `cert()` validates the fields and parses the key, so a broken secret fails at startup
		this.credential = cert({
			projectId: account.projectId,
			clientEmail: account.clientEmail,
			privateKey: account.privateKey,
		});

		// 3. Its own Firebase app: the SDK keeps apps in a global registry by name, and the default name would clash
		//    with a second location or with the app's own Firebase use. The project id is validated above, so it is
		//    passed unconditionally
		this.app = initializeApp(
			{ credential: this.credential, projectId: account.projectId },
			`novastarter-push-${randomUUID()}`,
		);

		// 4. The messaging client comes from the new app; when that fails, the app is already in the SDK's global
		//    registry holding live agents, unreachable and never deleted — so it is deleted, best-effort, before the
		//    error propagates
		try {
			this.messaging = getMessaging(this.app);
		} catch (error) {
			void deleteApp(this.app).catch(() => {});
			throw error;
		}
	}

	/**
	 * Send through the FCM HTTP v1 API.
	 *
	 * @param message - The message, with its `token`.
	 * @returns FCM's message name (`projects/<id>/messages/<id>`) as the id.
	 * @throws PushTargetGoneError for a token FCM no longer knows.
	 * @throws Error carrying FCM's error code for any other refusal, or the network error.
	 * @throws Error naming the deadline when `timeout` passes before FCM answers, the `TimeoutError` of
	 * `@novastarter/utils` as the cause; the request itself runs on, since the SDK call cannot be told to stop.
	 */
	async send(message: PushMessage): Promise<PushResult> {
		// 1. A subscription cannot be delivered here; `sendPush()` routes by platform, but a direct caller may not
		if (!message.token) {
			throw new Error('The fcm push driver needs a token; a subscription belongs to the webpush driver');
		}

		// 2. The SDK answers the message name on success and throws a coded error otherwise. It takes no timeout, so
		//    the deadline is raced here: a stalled request would otherwise sit out the HTTP client's minutes-long
		//    limits, and a queue job around the send with it. The request itself runs on past the deadline — the SDK
		//    call cannot be told to stop
		try {
			const request = this.messaging.send(toFcmMessage(message, this.config));

			const messageId = await (this.config.timeout === undefined ? request : withTimeout(request, this.config.timeout));

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
			throw new Error(`FCM credentials are invalid: ${toErrorMessage(error)}`, { cause: error });
		}
	}

	/**
	 * Release the Firebase app — its HTTP agents keep the process alive otherwise.
	 */
	async close(): Promise<void> {
		// 1. The app is always ours; deleting it releases its agents
		await deleteApp(this.app);
	}
}
