import type { CallOptions } from '@novastarter/utils';
import type { PushMessage, PushPlatform, PushResult } from './types.js';

/**
 * Contract every push driver implements — the `StorageDriver` of `@novastarter/storage`, for push notifications.
 *
 * Declared as an ambient class rather than an interface so that `typeof PushDriver` describes a constructor for
 * {@link PushManager.registerDriver}; no runtime code exists behind it. The built-in `console` driver lives in
 * `lib/drivers/`, vendor SDKs in `@novastarter/push-driver-*` packages. The constructor takes the `options` of the
 * location that names the driver; the `PushManager` calls it on the location's first use.
 */
export declare class PushDriver {
	/**
	 * The platforms the driver delivers to — what `sendPush()` checks a message's target against.
	 */
	readonly platforms: readonly PushPlatform[];

	/**
	 * What a browser needs to subscribe through this location: the VAPID public key (`applicationServerKey` of the
	 * browser's `PushManager.subscribe()`, no relation to the manager of this package). Only drivers of the `webpush`
	 * platform have one.
	 */
	readonly applicationServerKey?: string | undefined;

	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Driver-specific options, as given in the location's `options`.
	 */
	constructor(config: Record<string, unknown>);

	/**
	 * Deliver a message to its target.
	 *
	 * @param message - The message, its target already validated by `sendPush()` to match the driver's platform.
	 * @returns What the push service answered.
	 * @throws PushTargetGoneError when the push service says the target no longer exists — the caller deletes the
	 * stored subscription and never retries.
	 * @throws When the push service refuses the message otherwise or cannot be reached.
	 */
	send(message: PushMessage): Promise<PushResult>;

	/**
	 * Make a request of the push service's own API with the location's credentials, timeout and errors — the way to
	 * whatever the contract does not cover, an endpoint the driver has no wrapper for yet included.
	 *
	 * The signature is the same for every driver; what `method` means is the provider's, so code calling it is written
	 * for one provider: the verb and path of a REST API — FCM's `POST /v1/projects/{projectId}/messages:send` — a full
	 * URL on one of the provider's own hosts — `POST https://iid.googleapis.com/iid/v1:batchAdd` — or the command name
	 * of an RPC-style SDK. The parameters are the query of a `GET`, `HEAD` or `DELETE` and the body otherwise; a `Blob`
	 * or `File` among them is uploaded, where the API takes files.
	 *
	 * Optional: the `console` driver logs the request, while `webpush` and `apns` have one endpoint each and leave it
	 * out.
	 *
	 * @typeParam T - What the request answers with; the caller knows it from the provider's documentation.
	 * @param method - The verb and path, a full URL on the provider's hosts, or a command name.
	 * @param params - Its query or body.
	 * @param options - A timeout, an abort signal, extra headers, and `paramsIn` — `body` for an API that reads a
	 * `DELETE` body.
	 * @returns The provider's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError when the provider answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when the provider asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on the provider's hosts.
	 * @example
	 * ```ts
	 * await usePush().location('fcm').call?.('POST https://iid.googleapis.com/iid/v1:batchAdd', {
	 * 	to: '/topics/news',
	 * 	registration_tokens: [token],
	 * });
	 * ```
	 */
	call?<T = unknown>(method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<T>;

	/**
	 * Check the credentials work — a signature with the keys, a token from the service account — without sending.
	 *
	 * @throws When they do not.
	 */
	verify?(): Promise<void>;

	/**
	 * Release what the driver holds — an SDK's HTTP agents, HTTP/2 sessions — so the process can exit.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}
