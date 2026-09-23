import type { MessageHandler } from './types.js';

/**
 * Publish/subscribe bus shared by the local and Redis backends.
 */
export interface BusDriver {
	/**
	 * Publish a message to every subscriber of the given channel.
	 *
	 * @typeParam T - Payload type.
	 * @param channel - Channel to publish to.
	 * @param payload - Value sent to the subscribers.
	 * @returns Resolves once the message is handed to the backend.
	 * @throws `TypeError` when the payload cannot be serialised, such as a `BigInt` or a cyclic object, whether or
	 * not anybody subscribed.
	 */
	publish<T = unknown>(channel: string, payload: T): Promise<void>;

	/**
	 * Subscribe to messages on the given channel.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to subscribe to.
	 * @param callback - Invoked with every payload published on the channel.
	 * @returns Resolves once the subscription is active.
	 * @throws The error the backend refused the subscription with, such as a Redis `SUBSCRIBE` that failed; the
	 * callback is not registered then, so the call can be retried. `Error` when the driver was closed.
	 */
	subscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void>;

	/**
	 * Remove a callback from a channel.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to unsubscribe from.
	 * @param callback - The callback that was passed to `subscribe`.
	 * @returns Resolves once the callback is removed.
	 */
	unsubscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void>;

	/**
	 * Register a callback run every time the subscribing connection comes back after it was lost.
	 *
	 * Optional: only a driver that talks to a backend over a connection can lose it. Pub/sub is fire-and-forget, so
	 * every message published while the connection was down is gone for good; a subscriber that keeps state derived
	 * from the messages — an L1 cache kept coherent by invalidations — resets that state here.
	 *
	 * @param callback - Invoked after each reconnect once the subscriptions are active again, not on the first connect.
	 */
	onReconnect?(callback: () => void | Promise<void>): void;

	/**
	 * Release what the driver holds — the subscribing connection — so the process can exit.
	 *
	 * Optional: a driver in memory or on a connection it was handed has nothing to release. The manager calls it at
	 * shutdown.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}
