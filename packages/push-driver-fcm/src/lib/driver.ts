import { randomUUID } from 'node:crypto';
import { type CallOptions, type CallResponse, type HttpApi, request } from '@novastarter/http';
import type { PushDriver, PushMessage, PushPlatform, PushResult } from '@novastarter/push';
import { toErrorMessage, withTimeout } from '@novastarter/utils';
import { type App, cert, type Credential, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { FCM_API_URL, FCM_CALL_HOSTS } from './constants.js';
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
	 * FCM's APIs as a {@link call} reaches them: `fcm.googleapis.com` and the Instance ID API, the service account's
	 * access token fetched per call, `{projectId}` standing for its project, the location's timeout.
	 *
	 * @internal
	 */
	private readonly api: HttpApi;

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

		// 5. `call()` takes a fresh token per request — the credential caches it until it nears expiry, so this costs
		//    nothing most of the time — under the call's deadline; `request()` replaces a refusal with an error of its
		//    own, so the SDK's error, which may carry the request it made, never reaches the caller
		this.api = {
			provider: 'fcm',
			baseUrl: FCM_API_URL,
			hosts: FCM_CALL_HOSTS,
			headers: async () => {
				const { access_token: token } = await this.credential.getAccessToken();

				return { authorization: `Bearer ${token}` };
			},
			placeholders: { projectId: account.projectId },
			timeout: config.timeout,
		};
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
	 * Make a request of an FCM API with the service account's access token, the location's timeout and the kit's errors.
	 *
	 * The way to what `send()` does not cover — a topic subscription, a message with fields the kit does not map. The
	 * `method` is a verb and a path from `https://fcm.googleapis.com`, where `{projectId}` stands for the service
	 * account's project, or a full URL on one of {@link FCM_CALL_HOSTS}. The parameters are the query of a `GET`,
	 * `HEAD` or `DELETE` and the JSON body otherwise. Another `{name}` in the path is filled from the parameter of that
	 * name, URL-encoded, and that parameter is not sent again. The timeout and the signal bound the access token's
	 * fetch too.
	 *
	 * @typeParam T - What the request answers with; the caller knows it from FCM's documentation.
	 * @param method - The verb and the path or full URL: `POST /v1/projects/{projectId}/messages:send`.
	 * @param params - The placeholders' values, and its query or body; `undefined` ones are left out.
	 * @param options - A timeout over the location's, an abort signal, extra headers.
	 * @returns The status, the headers — names lower-cased — and FCM's answer: parsed JSON, else text; `undefined` for
	 * an empty one.
	 * @throws ProviderCallError when FCM answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when FCM answers `429`.
	 * @throws TimeoutError when the token and the request outlive the timeout.
	 * @throws Error when the method is malformed, a `{name}` placeholder is left unfilled, its URL is not on an FCM
	 * host, or the access token cannot be had.
	 * @example
	 * ```ts
	 * const push = usePush().location('fcm');
	 * const { data } = await push.call!<{ name: string }>('POST /v1/projects/{projectId}/messages:send', {
	 * 	message: { topic: 'news', data: { id: '42' } },
	 * });
	 * const info = await push.call!(
	 * 	'GET https://iid.googleapis.com/iid/info/{token}',
	 * 	{ token, details: true },
	 * 	{ headers: { access_token_auth: 'true' } },
	 * );
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		// 1. The shared request does it all: placeholders, the host check before a token is fetched — so a refused URL
		//    never uses the credentials — the token and the request under one deadline, and the kit's errors
		return request<T>(this.api, method, params, options);
	}

	/**
	 * Release the Firebase app — its HTTP agents keep the process alive otherwise.
	 */
	async close(): Promise<void> {
		// 1. The app is always ours; deleting it releases its agents
		await deleteApp(this.app);
	}
}
