import type { LocationConfig } from '@novastarter/utils';
import type { PushDrivers } from './lib/push-manager.js';
import type { PushMessage, PushPlatform, PushResult } from './types.js';

/**
 * Contract every push driver implements — the `Driver` of `@novastarter/storage`, for push notifications.
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
	 * Create a driver from a location's options.
	 *
	 * @param options - The driver's own options, as the location was registered with.
	 */
	constructor(options: Record<string, unknown>);

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

/**
 * Location entry as passed to {@link PushManager.registerLocation}: a driver of {@link PushDrivers} and its options.
 */
export type PushDriverConfig = LocationConfig<PushDrivers>;
