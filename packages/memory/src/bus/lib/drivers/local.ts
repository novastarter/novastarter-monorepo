import type { BusDriver } from '../../driver.js';
import type { MessageHandler } from '../../types.js';

/**
 * Options of {@link BusDriverLocal}, the `local` driver; it has none.
 */
export type BusDriverLocalConfig = Record<string, never>;

/**
 * In-process bus: publishing calls the subscribers registered in this process, nothing more.
 *
 * It exists so code written against the `BusDriver` interface runs unchanged in a single-process setup; it adds no
 * cross-process delivery.
 *
 * @example
 * ```ts
 * const bus = new BusDriverLocal({});
 *
 * await bus.subscribe('greetings', (payload) => console.log(payload));
 * await bus.publish('greetings', 'hello');
 * ```
 */
export class BusDriverLocal implements BusDriver {
	/**
	 * Subscribers per channel; a `Set` so the same callback is never registered twice.
	 *
	 * @internal
	 */
	private readonly handlers: Record<string, Set<MessageHandler<any>>>;

	/**
	 * Create an empty bus.
	 *
	 * @param _config - Driver-specific options, as given in the location's `options`; the local bus has none yet.
	 */
	constructor(_config: BusDriverLocalConfig = {}) {
		// 1. Start without subscribers
		this.handlers = {};
	}

	/**
	 * Deliver a payload to every subscriber of the channel.
	 *
	 * @typeParam T - Payload type.
	 * @param channel - Channel to publish to.
	 * @param payload - Value handed to every subscriber.
	 */
	async publish<T = unknown>(channel: string, payload: T): Promise<void> {
		// 1. Call every subscriber, swallowing errors: a failing handler must not stop delivery to the others nor
		//    crash the publisher, which matches how the Redis bus and event listeners in general behave
		this.handlers[channel]?.forEach((callback) => {
			try {
				callback(payload);
			} catch {
				// Do nothing..
			}
		});
	}

	/**
	 * Register a callback for a channel.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to subscribe to.
	 * @param callback - Invoked with every payload published on the channel.
	 */
	async subscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void> {
		// 1. Create the channel's set on first use
		const set = this.handlers[channel] ?? new Set();

		set.add(callback);

		this.handlers[channel] = set;
	}

	/**
	 * Remove a callback from a channel.
	 *
	 * @typeParam T - Payload type the callback expects.
	 * @param channel - Channel to unsubscribe from.
	 * @param callback - The callback that was passed to `subscribe`.
	 */
	async unsubscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void> {
		// 1. Unknown channels and callbacks are ignored rather than treated as errors
		this.handlers[channel]?.delete(callback);
	}
}
