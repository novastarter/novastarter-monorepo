/**
 * Callback invoked with every message published on a channel.
 *
 * @typeParam T - Payload type the subscriber expects.
 */
export type MessageHandler<T = unknown> = (payload: T) => void;

/**
 * Publish/subscribe bus shared by the local and Redis backends.
 */
export interface Bus {
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
}
