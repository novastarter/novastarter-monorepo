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
	 */
	publish<T = unknown>(channel: string, payload: T): Promise<void>;

	/**
	 * Subscribe to messages on the given channel.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to subscribe to.
	 * @param callback - Invoked with every payload published on the channel.
	 * @returns Resolves once the subscription is active.
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
	 * Release what the driver holds — the subscribing connection — so the process can exit.
	 *
	 * Optional: a driver in memory or on a connection it was handed has nothing to release. The manager calls it at
	 * shutdown.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}
